import { currentViewer } from "@pytorch-ph/domain-server/identity";

export async function currentProductUserId(): Promise<string | null> {
  return (await currentViewer()).userId;
}
