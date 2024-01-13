import { exec } from "child_process";

export const validateEnv = (): void => {
  let errors = false;
  if (!process.env.MYSQL_PWD) {
    console.error(`E: Please set the MYSQL_PWD variable`);
    errors = true;
  }
  if (!process.env.MYSQL_USER) {
    console.error(`E: Please set the MYSQL_USER variable`);
    errors = true;
  }
  if (!process.env.DATABASE) {
    console.error(`E: Please set the DATABASE variable`);
    errors = true;
  }
  if (errors) {
    process.exit(1);
  }
};

export type TableInfo = [
  FieldName: string,
  FieldType: string,
  Nullable: "YES" | "NO",
  Key: string | null | undefined,
  Default: string,
  Extra: string | null | undefined
];

export type TypeSchema = {
  name: string;
  resource: string;
  extends?: string | null;
  fields: Record<string, AttrField | RelField | IdField>;
};
type DeepType = {
  [key: string]: DeepType | string;
};
export type AttrField = {
  t: "attr";
  rawType: string;
  displayType: string;
  nullable: boolean;
};
export type RelField = {
  t: "rel";
  rawType: string;
  displayType: DeepType;
  nullable: boolean;
};
export type IdField = {
  t: "id";
  rawType: string;
  displayType: string;
};

export type FinalizeFunc = (
  attrs: Array<TypeSchema>,
  api: Array<TypeSchema>,
  db: Array<TypeSchema>,
  resources: Array<string>
) => [
  Attrs: Array<TypeSchema>,
  Api: Array<TypeSchema>,
  Db: Array<TypeSchema>,
  Resources: Array<string>
];

export const query = async (q: string): Promise<Array<string>> => {
  return await new Promise<Array<string>>((res, rej) => {
    exec(
      `echo '${q}' | mysql -u'${process.env.MYSQL_USER}' -D'${process.env.DATABASE}' | tail -n+2`,
      { env: process.env },
      (e, stdout, stderr) => {
        if (e) {
          rej(e);
        } else if (!stdout && stderr) {
          rej(new Error(stderr));
        } else {
          res(stdout.split(/[\n\r]+/).filter((l) => l !== ""));
        }
      }
    );
  });
};

export const pascalCase = (_words: Array<string>): string => {
  const words = [];
  for (const word of _words) {
    words.push(word[0].toUpperCase() + word.slice(1));
  }
  return words.join("");
};

export const snakeCase = (word: string): string => {
  const letters = [];
  const _letters = word.split("");
  for (const letter of _letters) {
    if (!Number.isNaN(Number(letter))) {
      letters.push(letter);
    } else if (letter === letter.toUpperCase()) {
      letters.push(`-${letter.toLowerCase()}`);
    } else {
      letters.push(letter);
    }
  }
  return letters.join("");
};

export const singular = (word: string): string => {
  return word.replace(/s$/, "");
};

export const getType = (info: TableInfo): string => {
  const rawType = info[1].toLowerCase();
  let t;

  if (rawType.match(/^enum\(/)) {
    // Enums
    const options = rawType
      .slice(5, -1)
      .replace(/["']/g, "")
      .split(/[\s]*,[\s]*/);
    t = `"${options.join(`" | "`)}"`;
  } else if (rawType.match(/binary|varbin|blob/)) {
    // Buffers
    t = "Buffer";
  } else if (rawType.match(/int|decimal|float|real/)) {
    // Numbers
    t = "number";
  } else {
    t = "string";
  }

  return t;
};

export const display = (
  _attrs: Array<TypeSchema>,
  _api: Array<TypeSchema>,
  _db: Array<TypeSchema>,
  resources: Array<string>
): void => {
  const r: { attrs: Array<string>; api: Array<string>; db: Array<string> } = {
    attrs: [],
    api: ["export namespace Api {"],
    db: ["export namespace Db {"],
  };

  const schemaSets: Array<[Array<TypeSchema>, keyof typeof r, string]> = [
    [_attrs, "attrs", ""],
    [_api, "api", "  "],
    [_db, "db", "  "],
  ];

  for (const set of schemaSets) {
    const [schemas, k, spaces] = set;
    for (const schema of schemas) {
      r[k].push(
        `${spaces}export type ${schema.name} = ${schema.extends ? `${schema.extends} & ` : ""}{`
      );
      for (const field in schema.fields) {
        const info = schema.fields[field];
        if (info.t === "id") {
          r[k].push(`${spaces}  ${field}: ${info.displayType};`);
        } else if (info.t === "attr") {
          r[k].push(`${spaces}  ${field}: ${info.displayType}${info.nullable ? ` | null` : ``};`);
        } else {
          r[k].push(
            `${spaces}  ${field}: { data: { id: string; type: "${snakeCase(field)}s" }${
              info.nullable ? ` | null` : ``
            } };`
          );
        }
      }
      r[k].push(`${spaces}}`);
      r[k].push("");
    }
  }

  r.api.push(`  export type Resource =`);
  r.api.push(`    | ${resources.join(`\n    | `)};`);
  r.api.push("}");
  r.api.push("");
  r.db.push(`  export type Resource =`);
  r.db.push(`    | ${resources.join(`\n    | `)};`);
  r.db.push("}");
  r.api.push("");

  let result = r.attrs.join("\n") + "\n" + r.api.join("\n") + "\n" + r.db.join("\n");
  console.log(result);
};

export const generateAndOutputTypes = async (clean: FinalizeFunc): Promise<void> => {
  const attrs = [];
  const api = [];
  const db = [];
  const resources = [];

  const tables = await query("SHOW TABLES;");
  for (const table of tables) {
    const resourceName = singular(pascalCase(table.split("-")));
    const attrsName = `${resourceName}Attributes`;
    resources.push(resourceName);

    const attrEntry: TypeSchema = {
      name: attrsName,
      resource: resourceName,
      fields: {},
    };
    const apiEntry: TypeSchema = {
      name: resourceName,
      resource: resourceName,
      extends: attrsName,
      fields: {},
    };
    const dbEntry: TypeSchema = {
      name: resourceName,
      resource: resourceName,
      extends: attrsName,
      fields: {},
    };

    const fields = await query(`DESCRIBE \`${table}\`;`);
    for (const field of fields) {
      const info = <TableInfo>field.split(/[\s]+/);

      if (info[0] === "id" || info[0] === "type") {
        // Treat ids and types specially
        apiEntry.fields.id = {
          t: "id",
          rawType: info[1],
          displayType: "string",
        };
        dbEntry.fields.id = {
          t: "id",
          rawType: info[1],
          displayType: getType(info),
        };
      } else if (info[0].match(/Id$/)) {
        // Turn references into relationships
        const field = info[0].slice(0, -2);
        apiEntry.fields[field] = {
          t: "rel",
          rawType: info[1],
          displayType: {
            data: {
              id: "string",
              type: `${snakeCase(field)}s`,
            },
          },
          nullable: info[2].toLowerCase() === "yes",
        };
        dbEntry.fields[info[0]] = {
          t: "attr",
          rawType: info[1],
          displayType: getType(info),
          nullable: info[2].toLowerCase() === "yes",
        };
      } else {
        // Everything else goes into attributes and NOT into the other namespaces
        attrEntry.fields[info[0]] = {
          t: "attr",
          rawType: info[1],
          displayType: getType(info),
          nullable: info[2].toLowerCase() === "yes",
        };
      }
    }

    // Add "type" to api types if not present
    if (!apiEntry.fields.type) {
      apiEntry.fields.type = {
        t: "attr",
        rawType: table,
        displayType: `"${table}"`,
        nullable: false,
      };
    }

    attrs.push(attrEntry);
    api.push(apiEntry);
    db.push(dbEntry);
  }

  display(...clean(attrs, api, db, resources));
};

export const run = async (clean: FinalizeFunc): Promise<void> => {
  validateEnv();
  await generateAndOutputTypes(clean).catch(console.error);
};
