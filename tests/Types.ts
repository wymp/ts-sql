import { IdConstraint, NullFilter, NoDefaults } from "../src";

export namespace Test {
  export type User = {
    id: string;
    name: string;
    email: string;
    dob: number | null;
    deleted: 0 | 1;
    verified: 0 | 1;
    primaryAddressId: string | null;
    status: "signed-up" | "ready-for-review" | "approved" | "denied" | "needs-followup";
    createdMs: number;
  };
  export const UserDefaults = {
    dob: null,
    deleted: 0 as const,
    verified: 0 as const,
    primaryAddressId: null,
    status: "signed-up" as const,
    createdMs: () => Date.now(),
  };

  export type Address = {
    id: string;
    street1: string;
    street2: string | null;
    city: string;
    state: string;
    country: string;
    zip: string;
  };
  export const AddressDefaults = {
    street2: null,
  };

  export type Organization = {
    id: string;
    name: string;
    createdMs: number;
  };
  export const OrganizationDefaults = {
    createdMs: () => Date.now(),
  };

  export type OrgRole = {
    organizationId: string;
    userId: string;
    role: "user" | "admin" | "superadmin";
  };

  export type Pet = {
    id: string;
    name: string;
    type: "dog" | "cat" | "mouse";
    ownerId: string;
  };

  export type TypeMap = {
    users: {
      type: User;
      constraints:
        | IdConstraint
        | { email: string | undefined | null }
        | { primaryAddressId: string | undefined | null };
      filters: Filter<{
        pet?: {
          type?: Pet["type"];
          nameLike?: string;
        };
        emailLike?: string;
      }>;
      defaults: typeof UserDefaults;
    };

    addresses: {
      type: Address;
      constraints: IdConstraint;
      filters: Filter<{
        country?: string | Array<string>;
        zip?: string | Array<string>;
      }>;
      defaults: typeof AddressDefaults;
    };

    organizations: {
      type: Organization;
      constraints: IdConstraint;
      filters: NullFilter;
      defaults: NoDefaults;
    };

    "org-roles": {
      type: OrgRole;
      constraints: { organizationId: string; userId: string; role: OrgRole["role"] };
      filters: Filter<{
        organizationId?: string;
        userId?: string;
      }>;
      defaults: NoDefaults;
    };

    pets: {
      type: Pet;
      constraints: IdConstraint;
      filters: Filter<{
        ownerId?: string;
        type?: Pet["type"];
        nameLike?: string;
      }>;
      defaults: NoDefaults;
    };
  };
}

type Filter<T> = { _t: "filter" } & { [K in keyof T]: undefined | null | T[K] };
