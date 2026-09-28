import { LoginForm } from "@pytorch-ph/domain-client/identity";
import { DemoAccounts } from "../demo-accounts";

export default function LoginPage() {
  return <LoginForm demoControls={<DemoAccounts />} />;
}
