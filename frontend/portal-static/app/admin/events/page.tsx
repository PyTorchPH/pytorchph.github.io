import EventWorkflowPage from "../../../../portal/app/admin/events/page";
import { OfficerOnly } from "../../officer-only";

export default function Page() {
  return <OfficerOnly path="/admin/events/"><EventWorkflowPage /></OfficerOnly>;
}
