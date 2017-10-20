/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
import { ILogger, Disposable, DisposableCollection } from '@theia/core/lib/common/';
import { ITaskClient, ITaskExitedEvent, ITasksChangedEvent, ITaskInfo, ITaskOptions, ITaskServer } from '../common/task-protocol';
import { Task } from './task';
import { RawProcess, RawProcessFactory, RawProcessOptions } from '@theia/process/lib/node/raw-process';
import { TerminalProcess, TerminalProcessFactory, TerminalProcessOptions } from '@theia/process/lib/node/terminal-process';
import { TaskManager } from './task-manager';
import * as fs from 'fs';
import * as path from 'path';
import URI from "@theia/core/lib/common/uri";
import { FileSystem } from '@theia/filesystem/lib/common';
import { isWindows } from '@theia/core/lib/common/os';
import { FileUri } from "@theia/core/lib/node";
import { TaskConfigurations, TaskConfigurationClient } from './task-configurations';

@injectable()
export class TaskServer implements ITaskServer, TaskConfigurationClient, Disposable {

    /* Task client to send notifications to.  */
    protected client: ITaskClient | undefined = undefined;
    protected taskToDispose = new Map<number, DisposableCollection>();
    protected readonly toDispose = new DisposableCollection();

    protected workspaceRoot: string = '';

    constructor(
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(RawProcessFactory) protected readonly rawProcessFactory: RawProcessFactory,
        @inject(TerminalProcessFactory) protected readonly terminalProcessFactory: TerminalProcessFactory,
        @inject(TaskManager) protected readonly taskManager: TaskManager,
        @inject(FileSystem) protected readonly fileSystem: FileSystem,
        @inject(TaskConfigurations) protected readonly taskConfigurations: TaskConfigurations
    ) {
        this.toDispose.push(taskConfigurations);

        const taskManagerListener = taskManager.onDelete(id => {
            const toDispose = this.taskToDispose.get(id);
            if (toDispose !== undefined) {
                toDispose.dispose();
                this.taskToDispose.delete(id);
            }
        });
        this.toDispose.push(taskManagerListener);
        this.taskConfigurations.init(this);
    }

    async setWorkspaceRoot(workspaceRoot: string): Promise<void> {
        this.workspaceRoot = workspaceRoot;
        await this.taskConfigurations.setWorkspaceRoot(workspaceRoot);
        return Promise.resolve();
    }

    dispose() {
        this.client = undefined;
        this.toDispose.dispose();
    }

    getTasks(): Promise<string[]> {
        return Promise.resolve(this.taskConfigurations.getTaskLabels());
    }

    run(task: ITaskOptions | string): Promise<ITaskInfo> {
        if (typeof task === 'string') {
            return new Promise((resolve, reject) => {
                this.taskConfigurations.getTask(task)
                    .then(t => this.doRun(t).then(taskInfo => resolve(taskInfo)))
                    .catch(e => {
                        reject(new Error(e));
                    });
            });

        } else {
            return this.doRun(task);
        }
    }

    protected doRun(options: ITaskOptions): Promise<ITaskInfo> {
        let task: Task;
        let proc: TerminalProcess | RawProcess;
        const processOptions = (isWindows && options.windowsProcessOptions !== undefined) ?
            options.windowsProcessOptions : options.processOptions;

        const command = processOptions.command;

        let cwd;
        if (processOptions.options === undefined) {
            processOptions.options = {
                'cwd': '',
                'env': ''
            };
        }

        cwd = options.cwd;
        if (cwd !== undefined) {
            cwd = cwd.replace(/\$workspace/gi, FileUri.fsPath(this.workspaceRoot));
        }

        // Use task's cwd wit hspawned process
        processOptions.options.cwd = cwd;
        // pass node env to new process
        processOptions.options.env = process.env;

        try {
            // check that command exists before creating process for it
            if (this.findCommand(command, cwd) === undefined) {
                throw (`Command not found: ${command}`);
            }

            // use terminal or raw process
            if (options.processType === 'terminal') {
                this.logger.info('Task: creating underlying terminal process');
                proc = this.terminalProcessFactory(<TerminalProcessOptions>processOptions);
            } else {
                this.logger.info('Task: creating underlying raw process');
                proc = this.rawProcessFactory(<RawProcessOptions>processOptions);
            }

            task = new Task(
                this.taskManager,
                proc,
                options.errorMatcherName
            );

            // when underlying process exits, notify tasks listeners
            const toDispose = new DisposableCollection();

            toDispose.push(
                proc.onExit(event => {
                    this.fireTaskExitedEvent({
                        'taskId': task.id,
                        'code': event.code,
                        'signal': event.signal
                    });
                })
            );

            this.taskToDispose.set(task.id, toDispose);

            return Promise.resolve(
                {
                    taskId: task.id,
                    osProcessId: proc.pid,
                    terminalId: (options.processType === 'terminal') ? proc.id : undefined,
                    processId: proc.id
                }
            );

        } catch (error) {
            this.logger.error(`Error occured while creating task: ${error}`);
            return Promise.reject(new Error(error));
        }
    }

    protected fireTaskExitedEvent(event: ITaskExitedEvent) {
        this.logger.debug(log => log(`task has exited:`, event));
        if (this.client) {
            this.client.onTaskExit(event);
        }
    }

    public tasksListChanged(tasks: string[]) {
        this.fireTaskChangedEvent({ 'tasks': tasks });
    }

    protected fireTaskChangedEvent(event: ITasksChangedEvent) {
        this.logger.debug(log => log(`Configured tasks changed:`, event));
        if (this.client) {
            this.client.onTasksConfigChanged(event);
        }
    }

    kill(id: number): Promise<void> {
        const taskToKill = this.taskManager.get(id);
        if (taskToKill !== undefined) {
            taskToKill.kill();
        }
        return Promise.resolve();
    }

    /** Set the client we send the notifications-to */
    setClient(client: ITaskClient | undefined) {
        this.client = client;
    }

    // Check if task command can be found, if so return its resolved
    // absolute path, else returns undefined
    private findCommand(command: string, cwd: string): string | undefined {
        const systemPath = process.env.PATH;

        if (path.isAbsolute(command) && fs.existsSync(command)) {
            return command;
        } else if (path.isAbsolute(command)) {
            const uri = new URI(cwd).resolve(command);
            const resolved_command = FileUri.fsPath(uri);
            if (fs.existsSync(resolved_command)) {
                return resolved_command;
            }
        } else {
            // look for command relative to cwd
            const resolved_command = FileUri.fsPath(new URI(cwd).resolve(command));
            if (fs.existsSync(resolved_command)) {
                return resolved_command;
            }

            const separator = isWindows ? ";" : ":";

            // just a command without path?
            if (path.basename(command) === command) {
                // search for this command in the system path
                if (systemPath !== undefined) {
                    const pathArray: string[] = systemPath.split(separator);
                    for (const p of pathArray) {
                        const candidate = FileUri.fsPath(new URI(p).resolve(command));
                        if (fs.existsSync(candidate)) {
                            return candidate;
                        }
                    }
                }
            }
        }

        return undefined;
    }
}

