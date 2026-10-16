import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { loadEnvironment } from './config/environment.js';
import { SafeExceptionFilter } from './safe-exception.filter.js';

/** 本机入口；前端通过同源代理访问API，暂不开放跨域凭据。 */
async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
  const description = new DocumentBuilder().setTitle('下次一定 API').setDescription('账号与组织、需求、团队任务、个人执行、周计划、周报和协作接口。').setVersion('1.0.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, description));
  await app.listen(environment.API_PORT, environment.API_HOST);
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check the ignored local configuration and port availability.');
  process.exitCode = 1;
});
