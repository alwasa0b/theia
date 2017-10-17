/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import 'mocha';
import * as chai from 'chai';
import * as path from 'path';
import { FileSearchServiceImpl } from './file-search-service-impl';
import { FileUri } from '@theia/core/lib/node';
import { MockLogger } from '@theia/core/lib/common/test/mock-logger';

const expect = chai.expect;

describe('search-service', () => {
    it('test shall fuzzy search', async () => {
        const service = new FileSearchServiceImpl(new MockLogger());
        const uri = FileUri.create(path.resolve(__dirname, "."));
        const matches = await service.find(uri.toString(), 'search');
        expect(matches.length).eq(4);
    });
});
