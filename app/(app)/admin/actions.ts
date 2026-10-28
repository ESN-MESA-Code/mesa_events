"use server";

import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions/run";
import * as A from "@/lib/actions/admin";

async function done<T>(p: Promise<T>) {
  const r = await p;
  revalidatePath("/admin");
  return r;
}

export async function addManualRole(input: unknown) {
  return done(run(A.addManualRole, input));
}
export async function removeManualRole(input: unknown) {
  return done(run(A.removeManualRole, input));
}
export async function retryJob(input: unknown) {
  return done(run(A.retryJob, input));
}
export async function syncRolesNow(input: unknown) {
  return done(run(A.syncRolesNow, input));
}
export async function updateSetting(input: unknown) {
  return done(run(A.updateSetting, input));
}
