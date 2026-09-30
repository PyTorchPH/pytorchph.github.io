import OrganizationPage from "../../../../portal/app/admin/organization/page";
import { OfficerOnly } from "../../officer-only";

export default function Page() {
  return <OfficerOnly path="/admin/organization/"><OrganizationPage /></OfficerOnly>;
}
