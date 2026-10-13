/*
 * THE BETA. This copy of IRIS is the experimental one handed to testers: it
 * says so on the lock screen, in the bar and in the page title, and tells them
 * to use invented data only, since the archive stays in their browser
 * unencrypted. A build made with NEXT_PUBLIC_IRIS_BETA=0 shows none of it.
 */
export const isBeta = process.env.NEXT_PUBLIC_IRIS_BETA !== "0";
