/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
import { ITaskOptions } from '../common/task-protocol';
import { ILogger, Disposable, DisposableCollection } from '@theia/core/lib/common/';
import URI from "@theia/core/lib/common/uri";
import * as jsoncparser from 'jsonc-parser';
import { ParseError } from "jsonc-parser";
import { FileSystemWatcherServer, DidFilesChangedParams } from '@theia/filesystem/lib/common/filesystem-watcher-protocol';
import { FileSystem } from '@theia/filesystem/lib/common';
import { FileUri } from "@theia/core/lib/node";
import * as os from 'os';

export interface TaskConfigurationClient {
    tasksListChanged: (event: string[]) => void;
}

/**
 * Watches potentially two tasks.json files: one in the user's home directory (in $home/.theia/ ),
 * and  another one in the current workspace ( in $workspace/.theia/ )
 */
@injectable()
export class TaskConfigurations implements Disposable {

    /* Task client to send notifications to.  */
    protected readonly toDispose = new DisposableCollection();

    // Map where all the parsed tasks, from tasks.json files, are saved
    protected userTasksMap = new Map<string, ITaskOptions>();
    protected workspaceTasksMap = new Map<string, ITaskOptions>();

    // protected workspaceRoot: string = '';

    protected homedirConfig: string = '';
    protected workspaceConfig: string = '';
    // for workspace, remember watch id so we can cancel watch
    protected workspaceConfigWatchId: number;

    /** directory under which we look for task config */
    protected readonly TASKFILEPATH = '.theia';
    /** task configuration file */
    protected readonly TASKFILE = 'tasks.json';

    // protected tasksChangedCallback: (event: object) => void;
    protected client: TaskConfigurationClient | undefined = undefined;

    constructor(
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(FileSystemWatcherServer) protected readonly watcherServer: FileSystemWatcherServer,
        @inject(FileSystem) protected readonly fileSystem: FileSystem
    ) {
        this.toDispose.push(watcherServer);
        watcherServer.setClient({
            onDidFilesChanged: p =>
                this.onDidTaskFileChange(p).then(() => {
                    this.getTaskLabels().then(tasks => {
                        if (this.client !== undefined) {
                            this.client.tasksListChanged(tasks);
                        }
                    });
                })
        });

        this.watchHomedirConfiguration();

        this.toDispose.push(Disposable.create(() => {
            this.userTasksMap.clear();
            this.workspaceTasksMap.clear();
            this.client = undefined;
        }));
    }

    init(client: TaskConfigurationClient) {
        this.client = client;
    }

    dispose() {
        this.toDispose.dispose();
    }

    protected watchHomedirConfiguration(): Promise<string> {
        return new Promise(resolve => {
            // compute home directory tasks.json path
            // let homeUri = FileUri.create(os.homedir());
            const homeUri = FileUri.create(os.userInfo().homedir);
            // this.homedirConfig
            const homedir = FileUri.fsPath(homeUri.resolve(this.TASKFILEPATH).resolve(this.TASKFILE));
            this.homedirConfig = homedir;
            // watch file
            this.watchConfigFile(homedir);

            // read tasks defined in tasks.json
            this.readTasks(homedir).then(tasks => {
                for (const task of tasks) {
                    this.userTasksMap.set(task.label, task);
                }
                resolve(homedir);
            });
        });
    }

    setWorkspaceRoot(rootUri: string): Promise<string> {
        return new Promise(resolve => {
            // unwatch old WS config file
            if (this.workspaceConfig !== '') {
                this.unwatchOldWorkspace(this.workspaceConfigWatchId);
            }

            // compute URL of new WS tasks file
            this.workspaceConfig = FileUri.fsPath(new URI(rootUri).resolve(this.TASKFILEPATH).resolve(this.TASKFILE));
            this.fileSystem.exists(this.workspaceConfig).then(exists => {
                if (exists) {
                    // watch new WS config file for changes
                    this.watchConfigFile(this.workspaceConfig).then(watchId => {
                        this.workspaceConfigWatchId = watchId;
                    });

                    // read tasks defined in tasks.json
                    this.readTasks(this.workspaceConfig).then(tasks => {
                        for (const task of tasks) {
                            this.workspaceTasksMap.set(task.label, task);
                        }
                        resolve(this.workspaceConfig);
                    });
                }
            });
        });
    }

    getTaskLabels(): Promise<string[]> {
        // concat user and workspace tasks
        return Promise.resolve([...this.workspaceTasksMap.keys(), ...this.userTasksMap.keys()]);
    }

    getTask(taskLabel: string): Promise<ITaskOptions> {
        return new Promise((resolve, reject) => {
            if (this.userTasksMap.has(taskLabel)) {
                resolve(this.userTasksMap.get(taskLabel));
            } else if (this.workspaceTasksMap.has(taskLabel)) {
                resolve(this.workspaceTasksMap.get(taskLabel));
            } else {
                reject(`Task with label ${taskLabel} not found`);
            }
        });

    }

    protected unwatchOldWorkspace(id: number) {
        this.watcherServer.unwatchFileChanges(id);
    }

    protected watchConfigFile(uri: string): Promise<number> {
        // watch file for changes
        return new Promise(resolve => {
            this.watcherServer.watchFileChanges(uri).then(id => {
                this.toDispose.push(Disposable.create(() =>
                    this.watcherServer.unwatchFileChanges(id))
                );
                resolve(id);
            });
        });
    }

    // a task config file we're watching has changed - update task list
    protected onDidTaskFileChange(params: DidFilesChangedParams): Promise<void> {
        return new Promise((resolve, reject) => {
            // task file changed? re-read it
            if (params.changes.some(c => FileUri.fsPath(c.uri) === this.homedirConfig)) {
                this.userTasksMap.clear();
                try {
                    this.readTasks(this.homedirConfig).then(tasks => {
                        for (const task of tasks) {
                            this.userTasksMap.set(task.label, task);
                        }
                        resolve();
                    });
                } catch (err) {
                    this.logger.error(err);
                    reject(err);
                }
            }

            if (params.changes.some(c => FileUri.fsPath(c.uri) === this.workspaceConfig)) {
                this.workspaceTasksMap.clear();
                try {
                    this.readTasks(this.workspaceConfig).then(tasks => {
                        for (const task of tasks) {
                            this.workspaceTasksMap.set(task.label, task);
                        }
                        resolve();
                    });
                } catch (err) {
                    this.logger.error(err);
                    reject(err);
                }
            }
        });
    }

    protected readTasks(uri: string): Promise<ITaskOptions[]> {
        return new Promise((resolve, reject) => {
            this.fileSystem.exists(uri).then(exists => {
                if (!exists) {
                    reject(`tasks.json file doesn't exist: ${uri}`);
                }
                this.fileSystem.resolveContent(uri).then(({ stat, content }) => {
                    const strippedContent = jsoncparser.stripComments(content);
                    const errors: ParseError[] = [];
                    const tasks = jsoncparser.parse(strippedContent, errors);

                    if (errors.length) {
                        for (const error of errors) {
                            this.logger.error("JSON parsing error", error);
                        }
                    }
                    resolve(this.filterDuplicates(tasks['tasks']));
                });
            }).catch(reason => {
                if (reason) {
                    this.logger.error(`Failed to read tasks ${uri}:`, reason);
                    reject(`Failed to read tasks ${uri}: ${reason}`);
                }
                reject('Failed to read tasks file');
            });
        });
    }

    private filterDuplicates(tasks: ITaskOptions[]): ITaskOptions[] {
        const filteredTasks: ITaskOptions[] = [];
        for (const task of tasks) {
            if (filteredTasks.some(t => t.label === task.label)) {
                this.logger.error(`Error parsing tasks.json: found duplicate entry for label ${task.label}`);
            } else {
                filteredTasks.push(task);
            }
        }
        return filteredTasks;
    }
}
