/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { ContainerModule, Container } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { TaskFrontendContribution } from './task-frontend-contribution';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging';
import { ITaskServer, taskPath } from '../common/task-protocol';
import { TaskWatcher } from '../common/task-watcher';
import { TerminalWidget, TerminalWidgetOptions } from '@theia/terminal/lib/browser/terminal-widget';
import { TaskTerminalWidgetFactory } from './task-service';
import { TaskService } from './task-service';
import { QuickOpenTask } from './quick-open-task';

export const buildsPath = '/services/task';

export default new ContainerModule(bind => {
    bind(TaskFrontendContribution).toSelf().inSingletonScope();
    bind(TaskService).toSelf().inSingletonScope();
    bind(CommandContribution).to(TaskFrontendContribution).inSingletonScope();
    bind(MenuContribution).to(TaskFrontendContribution).inSingletonScope();
    bind(TaskWatcher).to(TaskWatcher).inSingletonScope();
    bind(QuickOpenTask).toSelf().inSingletonScope();

    // terminal widget for terminal tasks
    bind(TaskTerminalWidgetFactory).toFactory(ctx =>
        (options: TerminalWidgetOptions) => {
            const child = new Container({ defaultScope: 'Singleton' });
            child.parent = ctx.container;
            child.bind(TerminalWidgetOptions).toConstantValue(options);
            return child.get(TerminalWidget);
        }
    );

    bind(ITaskServer).toDynamicValue(ctx => {
        const connection = ctx.container.get(WebSocketConnectionProvider);
        const taskWatcher = ctx.container.get(TaskWatcher);
        return connection.createProxy<ITaskServer>(taskPath, taskWatcher.getTaskClient());
    }).inSingletonScope();
});
