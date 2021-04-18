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
      constraint:
        | IdConstraint
        | { email: string | undefined | null }
        | { primaryAddressId: string | undefined | null };
      filter: Filter<{
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
      constraint: IdConstraint;
      filter: Filter<{
        country?: string | Array<string>;
        zip?: string | Array<string>;
      }>;
      defaults: typeof AddressDefaults;
    };

    organizations: {
      type: Organization;
      constraint: IdConstraint;
      filter: NullFilter;
      defaults: NoDefaults;
    };

    "org-roles": {
      type: OrgRole;
      constraint: { organizationId: string; userId: string; role: OrgRole["role"] };
      filter: Filter<{
        organizationId?: string;
        userId?: string;
      }>;
      defaults: NoDefaults;
    };

    pets: {
      type: Pet;
      constraint: IdConstraint;
      filter: Filter<{
        ownerId?: string;
        type?: Pet["type"];
        nameLike?: string;
      }>;
      defaults: NoDefaults;
    };
  };
}

type Filter<T> = { _t: "filter" } & { [K in keyof T]: undefined | null | T[K] };
