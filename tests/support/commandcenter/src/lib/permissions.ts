export const organizationRoles = ["admin", "board", "member", "volunteer"] as const;
export const financeRoles = ["none", "submitter", "approver", "treasurer", "approver_treasurer"] as const;

export type OrganizationRole = (typeof organizationRoles)[number];
export type FinanceRole = (typeof financeRoles)[number];

export type MembershipAccess = {
  role: string;
  finance_role: string;
  capabilities?: string[] | null;
};

export const capabilities = [
  "manageUsers",
  "manageOrganization",
  "manageInbox",
  "manageProjects",
  "manageContent",
  "manageEvents",
  "manageFinance",
  "submitExpenses",
  "viewFinance",
  "manageIntegrations",
  "manageKpis",
  "manageAiTemplates",
  "useAi",
] as const;

export type Capability = (typeof capabilities)[number];

export const organizationRoleLabels: Record<OrganizationRole, string> = {
  admin: "Admin",
  board: "Bestuur",
  member: "Crew",
  volunteer: "Vrijwilliger",
};

export const financeRoleLabels: Record<FinanceRole, string> = {
  none: "Geen financiële rol",
  submitter: "Kostenindiener",
  approver: "Goedkeurder",
  treasurer: "Boekhouder",
  approver_treasurer: "Goedkeurder en Boekhouder",
};

export function isAdmin(membership: MembershipAccess) {
  return membership.role === "admin";
}

export function isManager(membership: MembershipAccess) {
  return membership.role === "admin" || membership.role === "board";
}

export function isTeamMember(membership: MembershipAccess) {
  return membership.role === "admin" || membership.role === "board" || membership.role === "member";
}

export function hasPermission(membership: MembershipAccess, capability: Capability) {
  // Technical administration cannot be delegated through a custom profile.
  if (capability === "manageUsers" || capability === "manageIntegrations") return isAdmin(membership);
  if (capability === "manageFinance") return isAdmin(membership) || ["approver", "treasurer", "approver_treasurer"].includes(membership.finance_role);
  if (membership.capabilities?.includes(capability)) return true;
  switch (capability) {
    case "manageOrganization":
    case "manageInbox":
    case "manageKpis":
    case "manageAiTemplates":
      return isManager(membership);
    case "manageProjects":
    case "manageContent":
    case "manageEvents":
      return isTeamMember(membership);
    case "viewFinance":
      return isManager(membership) || membership.finance_role !== "none";
    case "submitExpenses":
    case "useAi":
      return true;
  }
}
