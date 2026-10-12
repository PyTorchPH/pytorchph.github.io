import {
  portfolioEvidenceContractSchema,
  resumeSourceDocumentSchema,
} from "@pytorch-ph/domain-protocol/resumes";
import { parse, stringify } from "yaml";

export function parsePortfolioEvidenceYaml(source: string) {
  return portfolioEvidenceContractSchema.parse(parse(source));
}

export function parseResumeSourceYaml(source: string) {
  return resumeSourceDocumentSchema.parse(parse(source));
}

export function formatResumeSourceYaml(source: unknown) {
  return stringify(resumeSourceDocumentSchema.parse(source), { lineWidth: 0 });
}
