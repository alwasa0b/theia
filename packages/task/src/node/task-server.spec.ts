/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as chai from 'chai';
import 'mocha';
import * as chaiAsPromised from 'chai-as-promised';
import { testContainer } from './test-resources/inversify.spec-config';
import { BackendApplication } from '@theia/core/lib/node/backend-application';
import { ITaskExitedEvent, ITasksChangedEvent, ITaskInfo, ITaskServer, ITaskOptions, ProcessType, ITaskOutputEntryFoundEvent } from '../common/task-protocol';
import { TaskWatcher } from '../common/task-watcher';
import { IShellTerminalServer } from '@theia/terminal/lib/common/shell-terminal-protocol';
import * as ws from 'ws';
import * as http from 'http';
import { isWindows } from '@theia/core/lib/common/os';
import URI from "@theia/core/lib/common/uri";
import { FileUri } from "@theia/core/lib/node";
import * as fs from 'fs';

chai.use(chaiAsPromised);

/**
 * Globals
 */

const expect = chai.expect;
const assert = require('assert');

// test script
const command_absolute_path = new URI(`file://${__dirname}`).resolve('test-resources').resolve('task');
const command_absolute_path_windows = new URI(`file://${__dirname}`).resolve('test-resources').resolve('task.bat');

const command_absolute_path__long_running = new URI(`file://${__dirname}`).resolve('test-resources').resolve('task-long-running');
const command_absolute_path__long_running_windows = new URI(`file://${__dirname}`).resolve('test-resources').resolve('task-long-running.bat');

const bogusCommand = 'thisisnotavalidcommand';
const command_to_find_in_path_unix = 'ls';
const command_to_find_in_path_windows = 'dir';

// TODO: test command that has relative path

describe('Task server / back-end', function () {
    this.timeout(5000);
    let server: http.Server;

    let taskServer: ITaskServer;
    // let fileSystem: FileSystem;
    const taskWatcher = testContainer.get(TaskWatcher);
    let shellTerminalServer: IShellTerminalServer;

    taskWatcher.onTaskOutputEntryFound((event: ITaskOutputEntryFoundEvent) => {
        // console.info(`*** Task ${event.taskId} has found an entry in its output: : ${event.entry}`);
    });
    taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
        // console.info(`*** Task ${event.taskId} has terminated. Exit code: ${event.code}, signal: ${event.signal}`);
    });

    taskWatcher.onTasksChanged((event: ITasksChangedEvent) => {
        // console.log(`***  Tasks.json has changed!!!');
    });

    before(async function () {
        // set theia root to 'test-resources' sub-folder, for the ends of the tests
        process.argv.push(`--root-dir=${new URI(__dirname).path.join(__dirname, 'test-resources')}`);
        const wsRoot: URI = new URI(__dirname).resolve('test-resources');

        const application = testContainer.get(BackendApplication);
        taskServer = testContainer.get(ITaskServer);
        taskServer.setClient(taskWatcher.getTaskClient());
        taskServer.setWorkspaceRoot(FileUri.fsPath(wsRoot));
        shellTerminalServer = testContainer.get(IShellTerminalServer);
        server = await application.start();
    });

    it("task running in terminal - is expected data received from the terminal ws server", async function () {
        const someString = 'someSingleWordString';

        // create task using terminal process
        const command = isWindows ? command_absolute_path_windows : command_absolute_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), [someString]));
        const terminalId = taskInfo.terminalId;

        // hook-up to terminal's ws and confirm that it outputs expected tasks' output
        const p = new Promise((resolve, reject) => {
            const socket = new ws(`ws://localhost:${server.address().port}/services/terminals/${terminalId}`);
            socket.on('message', msg => {
                taskServer.kill(taskInfo.taskId);
                // check output of task on terminal is what we expect
                const expected = `tasking... ${someString}`;
                if (msg.toString().indexOf(expected) !== -1) {
                    resolve();
                } else {
                    reject(`expected sub-string not found in terminal output. Expected: "${expected}" vs Actual: "${msg.toString()}"`);
                }

                socket.close();
            });
            socket.on('error', error => {
                reject(error);
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using raw process - task server success response shall not contain a terminal id", async function () {
        const someString = 'someSingleWordString';
        const command = isWindows ? command_absolute_path_windows : command_absolute_path;

        // create task using terminal process
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), [someString]));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });

        return expect(taskInfo.terminalId).to.be.undefined && expect(p).to.be.eventually.fulfilled;
    });

    it("task is executed successfully using terminal process, command has absolute path", async function () {
        const command = isWindows ? command_absolute_path_windows : command_absolute_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task is executed successfully using raw process, command has absolute path", async function () {
        const command = isWindows ? command_absolute_path_windows : command_absolute_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task can successfully execute command found in system path using a terminal process", async function () {
        const command = isWindows ? command_to_find_in_path_windows : command_to_find_in_path_unix;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', command, []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task can successfully execute command found in system path using a raw process", async function () {
        const command = isWindows ? command_to_find_in_path_windows : command_to_find_in_path_unix;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', command, []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using terminal process can be killed", async function () {
        const command = isWindows ? command_absolute_path__long_running_windows : command_absolute_path__long_running;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', FileUri.fsPath(command), []));

        await taskServer.kill(taskInfo.taskId);

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0 && event.signal !== '0') {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using raw process can be killed", async function () {
        const command = isWindows ? command_absolute_path__long_running_windows : command_absolute_path__long_running;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', FileUri.fsPath(command), []));

        await taskServer.kill(taskInfo.taskId);

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === null && event.signal === 'SIGTERM') {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using terminal process can handle command that does not exist", async function () {
        const p = taskServer.run(createTaskOptions('terminal', bogusCommand, []));
        return expect(p).to.be.eventually.rejectedWith(`Command not found: ${bogusCommand}`);
    });

    it("task using raw process can handle command that does not exist", async function () {
        const p = taskServer.run(createTaskOptions('raw', bogusCommand, []));
        return expect(p).to.be.eventually.rejectedWith(`Command not found: ${bogusCommand}`);
    });

    it("task server returns list of tasks from tasks.json", async function () {
        const tasks = await taskServer.getTasks();

        assert(tasks.length >= 2);
        return expect(tasks[0]).to.equal('test task');
    });

    it("Successfully run task from tasks.json by name", async function () {
        const taskNames = await taskServer.getTasks();
        const taskInfo = await taskServer.run(taskNames[0]);

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(`taskId: ${taskInfo.taskId}, event taskId: ${event.taskId}, code: ${event.code}, signal: ${event.signal}`);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("handle running non-existing task from tasks.json", async function () {
        const taskName = "doesnotexists"
        const p = taskServer.run(taskName);

        return expect(p).to.be.eventually.rejectedWith(`Task with label ${taskName} not found`);
    });

    it("task server emits ITasksChangedEvent if tasks.json is modified", async function () {
        const tasksFile = new URI(`file://${__dirname}`).resolve('test-resources').resolve('.theia').resolve('tasks.json');
        const newTaskName = 'this-is-a-new-name';
        const currentTaskNames = await taskServer.getTasks();

        // change 1st task name
        await replaceStringInFile(FileUri.fsPath(tasksFile), currentTaskNames[0], newTaskName);

        after(async () => {
            // restore original task name when test suite done
            await replaceStringInFile(FileUri.fsPath(tasksFile), newTaskName, currentTaskNames[0]);
        });

        const p = new Promise((resolve, reject) => {
            // will timeout if event not received, failing test case
            taskWatcher.onTasksChanged((event: ITasksChangedEvent) => {
                if (event.tasks[0] === newTaskName) {
                    resolve();
                } else {
                    reject(`Unexpected task name: ${event.tasks[0]} - expected: ${newTaskName}`);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });


});


function replaceStringInFile(file: string, toReplace: string, replacement: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(file, 'utf8');
        let newContent: string = '';

        stream.on('data', data => {
            const r = data.toString().replace(toReplace, replacement);
            newContent += r;
        });

        stream.on('end', () => {
            fs.writeFileSync(file, newContent);
            resolve();
        });
    });


}


function createTaskOptions(processType: ProcessType, command: string, args: string[]): ITaskOptions {
    return {
        label: "test task",
        isBuild: false,
        processType: processType,
        'processOptions': {
            'command': command,
            'args': args
        },

        'cwd': __dirname,
        'errorMatcherName': ''
    };
}

