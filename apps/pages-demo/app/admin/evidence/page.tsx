import EvidenceReviewPage from "../../../../portal/app/admin/evidence/page";
import { OfficerOnly } from "../../officer-only";

export default function Page() {
  return <OfficerOnly path="/admin/evidence/"><EvidenceReviewPage /></OfficerOnly>;
}
