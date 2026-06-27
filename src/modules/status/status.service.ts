import { Injectable } from '@nestjs/common';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { TemplateService } from '../template/template.service';
import { STORAGE_PATHS } from '../../common/utils/storage-paths';

export interface StatusResponse {
  success: boolean;
  status: string;
  message: string;
  data: {
    directories: Record<string, boolean>;
    fileCount: Record<string, number>;
    templates: string[];
    // No exponer URLs internas ni config sensible en endpoint público
  };
}

@Injectable()
export class StatusService {
  constructor(private templateService: TemplateService) {}

  /**
   * Get server status
   * No se retorna carboneApi, publicUrl ni ninguna configuración interna.
   * El endpoint /status es @Public() — solo expone estado operacional.
   */
  getStatus(): StatusResponse {
    const pdfDir = STORAGE_PATHS.pdfs;
    const certsDir = STORAGE_PATHS.certs;
    const templatesDir = STORAGE_PATHS.templates;

    // Check directory existence
    const dirStatus = {
      pdfs: existsSync(pdfDir),
      pdfs_con_firma: existsSync(join(pdfDir, 'con_firma')),
      pdfs_others: existsSync(join(pdfDir, 'others')),
      certs: existsSync(certsDir),
      templates: existsSync(templatesDir),
    };

    // Count files in each directory
    const fileCount = {
      pdfs_con_firma: existsSync(join(pdfDir, 'con_firma'))
        ? readdirSync(join(pdfDir, 'con_firma')).length
        : 0,
      pdfs_others: existsSync(join(pdfDir, 'others'))
        ? readdirSync(join(pdfDir, 'others')).length
        : 0,
      certs: existsSync(certsDir)
        ? readdirSync(certsDir).filter((f) => f.endsWith('.p12')).length
        : 0,
    };

    // Get template names
    const templates = this.templateService
      .listTemplatesWithMetadata()
      .map((t) => t.name);

    return {
      success: true,
      status: 'ok',
      message: 'Servidor funcionando correctamente',
      data: {
        directories: dirStatus,
        fileCount: fileCount,
        templates: templates,
        // Eliminado: carboneApi, publicUrl — no exponer URLs internas
      },
    };
  }
}
