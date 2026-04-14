export function isAdminPlan(userOrPlan) {
  if (userOrPlan === null || userOrPlan === undefined) return false;
  const plan = typeof userOrPlan === 'string' ? userOrPlan : userOrPlan?.plan;
  return plan === 'admin';
}
