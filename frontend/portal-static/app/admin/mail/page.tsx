import EmailDraftsPage from "../../../../portal/app/admin/mail/page";
import { OfficerOnly } from "../../officer-only";

export default function Page() {
  return <OfficerOnly path="/admin/mail/"><EmailDraftsPage /></OfficerOnly>;
}
