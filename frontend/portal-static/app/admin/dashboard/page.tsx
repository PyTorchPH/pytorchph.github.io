import { DashboardCommandCenter } from "@pytorch-ph/domain-client/organization";
import { OfficerOnly } from "../../officer-only";

export default function AdminDashboardPage() {
  return <OfficerOnly path="/admin/dashboard/"><DashboardCommandCenter /></OfficerOnly>;
}
