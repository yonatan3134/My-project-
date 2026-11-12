import { WaClient } from "../wa/client.js";

/** Connects with the saved session, or exits with an explanation. */
export async function connectOrExit(): Promise<WaClient> {
  const client = new WaClient({ allowLinking: false, pairingPhone: null });
  client.on("logged_out", (reason: string) => {
    console.error(`הבוט לא מחובר לוואטסאפ (${reason}). הרץ קודם: npm run link`);
    process.exit(1);
  });
  await client.start();
  if (!(await client.waitOpen(60_000))) {
    console.error("לא הצלחתי להתחבר לוואטסאפ תוך דקה. בדוק את האינטרנט בשרת ונסה שוב.");
    process.exit(1);
  }
  return client;
}
