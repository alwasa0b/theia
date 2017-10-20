/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from "inversify";
import { ILogger } from '@theia/core/lib/common';
import { FrontendApplication } from '@theia/core/lib/browser';
import { ITaskServer, ITaskOutputEntryFoundEvent, ITaskExitedEvent } from '../common/task-protocol';
import { TerminalWidget, TerminalWidgetOptions } from '@theia/terminal/lib/browser/terminal-widget';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { TaskWatcher } from '../common/task-watcher';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ProblemMarker } from '@theia/markers/lib/common/problem-marker';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

export const TaskTerminalWidgetFactory = Symbol('TaskTerminalWidgetFactory');
export interface TaskTerminalWidgetFactory {
    (options: TerminalWidgetOptions): TerminalWidget;
}

@injectable()
export class TaskService {

    constructor(
        @inject(FrontendApplication) protected readonly app: FrontendApplication,
        @inject(ITaskServer) protected readonly taskServer: ITaskServer,
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(TaskTerminalWidgetFactory) protected readonly terminalWidgetFactory: TaskTerminalWidgetFactory,
        @inject(TaskWatcher) protected readonly taskWatcher: TaskWatcher,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
    ) {
        this.taskWatcher.onTaskOutputEntryFound((event: ITaskOutputEntryFoundEvent) => {
            if (ProblemMarker.is(event.entry)) {
                // problem marker
                this.messageService.info(`Task ${event.taskId} has sent a problem marker`);
                // TODO: handler markers

            } else {
                // eventually other type of markers
                logger.error(`Received unsupported type of marker for task ${event.taskId}`);
            }

        });

        // set workspace root for the backend task server serving this instance
        this.workspaceService.root.then(root => {
            this.taskServer.setWorkspaceRoot(root.uri);
        });

        this.taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
            this.messageService.info(`Task ${event.taskId} has completed. Exit code: ${event.code}, signal: ${event.signal}`);
        });

    }

    public async getTasks(): Promise<string[]> {
        let tasks: string[];

        tasks = await this.taskServer.getTasks();
        return tasks;
    }

    public async run(task: string): Promise<void> {
        let taskInfo;
        try {

            taskInfo = await this.taskServer.run(task);

        } catch (error) {
            alert(`Error launching task: ${error}`);
            return;
        }

        this.logger.debug(`Task created. task id: ${taskInfo.taskId}, OS ProcessId: ${taskInfo.osProcessId} `);

        // open terminal widget:
        if (taskInfo.terminalId !== undefined) {
            this.attachTerminal(taskInfo.terminalId, taskInfo.taskId);
        }
    }

    protected attachTerminal(terminalId: number, taskId: number): void {
        const newTerminal = this.terminalWidgetFactory({
            endpoint: { path: '/services/terminals' },
            id: 'task-' + terminalId,
            caption: `Task #${taskId}`,
            label: `Task #${taskId}`,
            destroyTermOnClose: false
        });

        newTerminal.start(terminalId);
        this.app.shell.addToMainArea(newTerminal);
        this.app.shell.activateMain(newTerminal.id);
    }

}

