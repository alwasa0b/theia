/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { JsonRpcServer } from '@theia/core/lib/common/messaging/proxy-factory';
import { Marker } from '@theia/markers/lib/common/marker';
import { RawProcessOptions } from '@theia/process/lib/node/raw-process';
import { TerminalProcessOptions } from '@theia/process/lib/node/terminal-process';

export const taskPath = '/services/task';
export const ITaskServer = Symbol('ITaskServer');
export const ITaskClient = Symbol('ITaskClient');

export type ProcessType = 'terminal' | 'raw';

export interface ITaskInfo {
    /** internal unique task id */
    taskId: number,
    /** terminal id. Defined if task is run as a terminal process */
    terminalId?: number,
    /** internal unique process id */
    processId?: number,
    /** OS PID of the process running the task */
    osProcessId: number
}


export interface ITaskOptions {
    label: string,
    /** 'raw' or 'terminal' */
    processType: ProcessType,
    /** contains 'command', 'args?', 'options?' */
    processOptions: RawProcessOptions | TerminalProcessOptions,
    /** windows version of processOptions. Used in preference on Windows */
    windowsProcessOptions?: RawProcessOptions | TerminalProcessOptions,
    /** the 'current working directory' the task will run in */
    cwd: string,
    /** is it a build task? */
    isBuild: boolean,
    /** for future needs - when we hook up error parser to tasks */
    errorMatcherName: string,
    errorMatcherOptions?: object
}

export interface ITaskServer extends JsonRpcServer<ITaskClient> {
    /** Get a list of avaialble task labels, for tasks configured in tasks.json */
    getTasks(): Promise<string[]>
    /** Run a task - either pass details of task or its label */
    run(task: ITaskOptions | string): Promise<ITaskInfo>;
    /** Kill a task. "id" id the task id */
    kill(id: number): Promise<void>;
    /** The clien is reponsible to set its workspace root directory */
    setWorkspaceRoot(workspaceRoot: string): Promise<void>;
}

/** Event sent when a task has concluded its execution */
export interface ITaskExitedEvent {
    taskId: number;
    code: number;
    signal?: string;
}

/** Event sent when the task's output parser has found an entry that matches its IMatcher */
export interface ITaskOutputEntryFoundEvent {
    taskId: number,
    entry: Marker<object>
}

/**
 * Event sent when the tasks.json file has been detected to have changed. Clients can then
 * ask the task serever for an updated list of tasks, if interested
 */
export interface ITasksChangedEvent {
    tasks: string[]
}

export interface ITaskClient {
    onTaskExit(event: ITaskExitedEvent): void;
    onTaskOutputEntryFound(event: ITaskOutputEntryFoundEvent): void;
    onTasksConfigChanged(event: ITasksChangedEvent): void
}
