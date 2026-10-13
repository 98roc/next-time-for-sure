import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { loadEnvironment } from './config/environment.js';

/** 本机入口；前端通过同源代理访问API，暂不开放跨域凭据。 */
async function bootstrap(): Promise<void> {
  const environment = loadEnvironment();
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const description = new DocumentBuilder().setTitle('下次一定 API').setDescription('第1阶段工程探针；业务与认证尚未交付。').setVersion('0.1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, description));
  await app.listen(environment.API_PORT, environment.API_HOST);
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check the ignored local configuration and port availability.');
  process.exitCode = 1;
});
