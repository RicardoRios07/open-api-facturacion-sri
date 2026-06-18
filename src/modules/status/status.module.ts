import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { TemplateModule } from '../template/template.module';
import { DatabaseModule } from '../../database/database.module';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { SriHealthIndicator } from './sri.health';

@Module({
  imports: [TerminusModule, TemplateModule, DatabaseModule, ConfigModule],
  controllers: [StatusController],
  providers: [
    StatusService,
    DatabaseHealthIndicator,
    RedisHealthIndicator,  // STATUS-01
    SriHealthIndicator,    // STATUS-03
  ],
})
export class StatusModule {}
