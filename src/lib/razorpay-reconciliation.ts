/** Read every page: the first 100 payments may omit a captured checkout. */
export async function capturedPaymentPages<T extends { status: string; captured: boolean }>(
  fetchPage: (skip: number) => Promise<{ items?: T[] }>,
) {
  const payments: T[] = [];
  for (let skip = 0; ; skip += 100) {
    const page = (await fetchPage(skip)).items || [];
    payments.push(...page.filter((payment) => payment.status === "captured" && payment.captured));
    if (page.length < 100) return payments;
  }
}
