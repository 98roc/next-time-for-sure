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
  const description = new DocumentBuilder().setTitle('下次一定 API').setDescription('工程探针、账号会话与组织权限管理；任务及周报能力待后续阶段交付。').setVersion('0.2.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, description));
  await app.listen(environment.API_PORT, environment.API_HOST);
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check the ignored local configuration and port availability.');
  process.exitCode = 1;
});
