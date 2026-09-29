import type { DepartmentBrief, GeneratedDocument } from "@pytorch-ph/domain-protocol/organization/workflow";

/**
 * The document injector — render a document from structured data (JSON now, SQL rows once the
 * DB exists) into a user-provided TEMPLATE. Mirrors the legacy `renderers/` pattern
 * (data + template -> file), now for org papers.
 */
export interface DocumentInjector {
  /**
   * @param brief   the per-department brief (recipient + required content + finalized draft)
   * @param record  structured data to fill the template (JSON object or a SQL row mapped to one)
   * @param templateId  which template to render with
   */
  render(
    brief: DepartmentBrief,
    record: Record<string, unknown>,
    templateId: string,
  ): Promise<GeneratedDocument>;
}

/**
 * Stub — BLOCKED on the real template the user will provide. The template slot lives at
 * config/document-template.example.json. Once the template + output format are known, implement
 * rendering (e.g. handlebars/DOCX/Google Docs) here.
 */
export class TemplateDocumentInjector implements DocumentInjector {
  async render(
    _brief: DepartmentBrief,
    _record: Record<string, unknown>,
    _templateId: string,
  ): Promise<GeneratedDocument> {
    throw new Error(
      "not implemented: TemplateDocumentInjector.render — awaiting the document template + target format",
    );
  }
}
