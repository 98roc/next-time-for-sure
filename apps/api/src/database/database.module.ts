import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';

/** 全应用复用连接池，不由各业务模块分别创建连接。 */
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
