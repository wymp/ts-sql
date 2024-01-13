import { IdConstraint, NullFilter, strId, both } from "../src";

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

  export type Address = {
    id: string;
    street1: string;
    street2: string | null;
    city: string;
    state: string;
    country: string;
    zip: string;
  };

  export type Organization = {
    id: string;
    name: string;
    createdMs: number;
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

  export const Defaults = {
    users: both(strId, {
      dob: null,
      deleted: 0 as const,
      verified: 0 as const,
      primaryAddressId: null,
      status: "signed-up" as const,
      createdMs: () => Date.now(),
    }),
    addresses: both(strId, {
      street2: null,
    }),
    organizations: both(strId, {
      createdMs: () => Date.now(),
    }),
    "org-roles": strId,
    pets: strId,
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
      defaults: (typeof Defaults)["users"];
    };

    addresses: {
      type: Address;
      constraints: IdConstraint;
      filters: Filter<{
        country?: string | Array<string>;
        zip?: string | Array<string>;
      }>;
      defaults: (typeof Defaults)["addresses"];
    };

    organizations: {
      type: Organization;
      constraints: IdConstraint;
      filters: NullFilter;
      defaults: (typeof Defaults)["organizations"];
    };

    "org-roles": {
      type: OrgRole;
      constraints: { organizationId: string; userId: string; role: OrgRole["role"] };
      filters: Filter<{
        organizationId?: string;
        userId?: string;
      }>;
      defaults: (typeof Defaults)["org-roles"];
    };

    pets: {
      type: Pet;
      constraints: IdConstraint;
      filters: Filter<{
        ownerId?: string;
        type?: Pet["type"];
        nameLike?: string;
      }>;
      defaults: (typeof Defaults)["pets"];
    };
  };
}

type Filter<T> = { _t: "filter" } & { [K in keyof T]: undefined | null | T[K] };
