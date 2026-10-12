import WebsitePage from "../../../../portal/app/admin/website/page";
import { OfficerOnly } from "../../officer-only";
export default function Page() { return <OfficerOnly path="/admin/website/"><WebsitePage /></OfficerOnly>; }
