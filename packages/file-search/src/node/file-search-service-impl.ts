/*
 * Copyright (C) 2017 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { FileSearchService } from '../common/file-search-service';
import * as fs from "fs";
import * as path from "path";
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/node';
import * as fuzzy from 'fuzzy';
import { injectable, inject } from 'inversify';
import * as parser from 'gitignore-parser';
import { ILogger } from '@theia/core';

type Filtered = (simpleName: string, fullPath: string) => boolean;

@injectable()
export class FileSearchServiceImpl implements FileSearchService {

    constructor( @inject(ILogger) private logger: ILogger) { }

    async find(uri: string, searchPattern: string, options?: { fuzzyMatch?: boolean, limit?: number, useGitignore?: boolean }): Promise<string[]> {
        const basePath = FileUri.fsPath(new URI(uri));
        const opts = {
            fuzzyMatch: true,
            limit: Number.MAX_SAFE_INTEGER,
            useGitignore: true,
            ...options
        };
        const result: string[] = [];
        const limitReached = new Error("limit reached");
        const filtered = this.getFiltered(basePath, opts);
        try {
            this.findRecursive(basePath, filtered, filePath => {
                if (result.length >= opts.limit) {
                    throw limitReached;
                }
                if (opts.fuzzyMatch && fuzzy.test(searchPattern, filePath)) {
                    result.push(FileUri.create(filePath).toString());
                } else {
                    if (filePath.toLocaleLowerCase().indexOf(searchPattern.toLocaleLowerCase()) !== -1) {
                        result.push(FileUri.create(filePath).toString());
                    }
                }
            });
        } catch (e) {
            if (e !== limitReached) {
                throw e;
            }
        }
        return result;
    }

    private findRecursive(filePath: string, filtered: Filtered, acceptor: (fileName: string) => void) {
        const result = fs.readdirSync(filePath);
        for (const child of result) {
            const childPath = path.join(filePath, child);
            if (!filtered(child, childPath)) {
                if (fs.statSync(childPath).isDirectory()) {
                    this.findRecursive(childPath, filtered, acceptor);
                } else {
                    acceptor(childPath);
                }
            }
        }
    }

    private getFiltered(basePath: string, options: { fuzzyMatch: boolean, limit: number, useGitignore: boolean }): Filtered {
        const defaultFilter = (simpleName: string) =>
            simpleName === '.git' ||
            simpleName.startsWith('.git/');
        if (options.useGitignore) {
            const gitIgnore = this.findGitIgnore(basePath);
            if (gitIgnore) {
                const matcher = parser.compile(gitIgnore.contents);
                return (short, long) => defaultFilter(short) || matcher.denies(short);
            }
        }
        return defaultFilter;
    }

    private findGitIgnore(basePath: string): { path: string, contents: string } | undefined {
        try {
            const fullPath = path.join(basePath, '.gitignore');
            const result = fs.readFileSync(fullPath, 'utf-8');
            if (this.logger.isInfo()) {
                this.logger.info(`Found gitignore below ${fullPath}`);
            }
            return {
                path: basePath,
                contents: result
            };
        } catch {
            try {
                const parent = path.resolve(basePath, '..');
                return this.findGitIgnore(parent);
            } catch {
                return undefined;
            }
        }
    }

}
