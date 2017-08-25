/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
import { injectable } from 'inversify';
import { Task } from './task';
import { Emitter, Event } from '@theia/core/lib/common';
import { Disposable } from '../../../core/lib/common';

// inspired from process-manager.ts

@injectable()
export class TaskManager implements Disposable {

    protected readonly tasks: Map<number, Task> = new Map();
    protected id: number = 0;
    protected readonly deleteEmitter = new Emitter<number>();

    register(task: Task): number {
        const id = this.id;
        this.tasks.set(id, task);
        this.id++;
        return id;
    }

    get(id: number): Task | undefined {
        return this.tasks.get(id);
    }

    delete(task: Task): void {
        this.tasks.delete(task.id);
        this.deleteEmitter.fire(task.id);
    }

    get onDelete(): Event<number> {
        return this.deleteEmitter.event;
    }

    dispose() {
        this.tasks.clear();
    }
}
