/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject } from 'inversify';
import { TaskManager } from './task-manager';
import { Process } from '@theia/process/lib/node/process';

@injectable()
export class Task {
    protected taskId: number;
    protected taskProcess: Process;
    // linter: string | undefined;

    constructor(
        @inject(TaskManager) protected readonly taskManager: TaskManager,
        process: Process,
        linter: string | undefined
    ) {
        this.taskId = this.taskManager.register(this);
        this.taskProcess = process;

        this.taskProcess.onExit(event => {
            this.taskManager.delete(this);
        });
    }

    kill() {
        this.process.kill();
    }

    get process() {
        return this.taskProcess;
    }

    get id() {
        return this.taskId;
    }

}
