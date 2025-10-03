import { v5 as uuidv5, v4 as uuidv4 } from "uuid";
import { splitValues, addIfMissing, checkNotEmpty, checkPropertyExists} from "./utils/index.js";


const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const EMAIL_FIELD_REGEX = /^(email|primaryEmail|mainEmail|userEmail)$/i;
const ADDITIONAL_EMAILS_REGEX = /^(additionalEmails|otherEmails|emails)$/i;

const EMAIL_TO_UUID: Map<string, string> = new Map();

type Person = {
  userID?: string;
  [key: string]: unknown;
};

function validateEmail(email: string): boolean {
  return typeof email === "string" && email.trim().length > 0;
}

export function extractEmails(person: RecordData): string[] {
  const emails: string[] = [];
  for (const key of Object.keys(person)) {
    const isValidEmailField = EMAIL_FIELD_REGEX.test(key);
    if (isValidEmailField && validateEmail(person[key])) {
      emails.push(person[key].trim().toLowerCase());
    }
    const isValidEmailsString =
      ADDITIONAL_EMAILS_REGEX.test(key) && typeof person[key] === "string";
    if (isValidEmailsString) {
      emails.push(...splitValues(person[key]).map((email) => email.trim().toLowerCase()));
    }
  }
  return emails;
}

export function getUuidForPerson(person: RecordData): string {
  const emails = extractEmails(person);
  if (emails.length > 0) {
    return uuidv5(emails[0], NAMESPACE);
  }
  return uuidv4();
}

export function assignUuidsToBatch(
  batch: RecordData[]
): RecordData[] {
  return batch.map((row) => {
    if (!row) return row;
    const emails = extractEmails(row);
    let assignedUuid: string | undefined;
    for (const email of emails) {
      const uuid = EMAIL_TO_UUID.get(email);
      if (uuid) {
        assignedUuid = uuid;
        break;
      }
    }
    if (!assignedUuid) {
      assignedUuid = getUuidForPerson(row);
    }
    for (const email of emails) {
      EMAIL_TO_UUID.set(email, assignedUuid);
    }
    row.userID = assignedUuid;
    return row;
  });
}

function getUuidRecordMap(allResults: AnalysisResult[]): Map<string, Person[]> {
  const uuidMap = new Map<string, Person[]>();
  for (const result of allResults) {
    const person = result.person as Person;
    if (!person || !person.userID) continue;
    const uuid = person.userID;
    if (!uuidMap.has(uuid)) uuidMap.set(uuid, []);
    uuidMap.get(uuid)!.push(result);
  }

  return uuidMap;
}

function mergePerson(mergePerson: Person, person: Person) {
  for (const key of Object.keys(person)) {
    const value = person[key];
    if (Array.isArray(value)) {
      mergePerson[key] = Array.isArray(mergePerson[key])
        ? addIfMissing(mergePerson[key], value)
        : value;
    } else if (checkNotEmpty(value)) {
      const noExistingValue = !checkPropertyExists(mergePerson, key) || !checkNotEmpty(mergePerson[key]);
      if (noExistingValue) {
        mergePerson[key] = value;
      }
    }
  }
}

function mergeGroup(uuid: string, group: AnalysisResult[]): AnalysisResult {
  const mergedPerson: Person = {} as Person;
  const objects: unknown[] = [];
  const actions: unknown[] = [];
  for (const result of group) {
    const person = result.person as Person;
    if (!person) continue;
    mergePerson(mergedPerson, person);
    if (result.object) objects.push(result.object);
    if (result.action) actions.push(result.action);
  }
  mergedPerson["userID"] = uuid;
  mergedPerson["@id"] = uuid;
  return {
    person: mergedPerson,
    object: objects.length > 0 ? objects : null,
    action: actions.length > 0 ? actions : null,
  };
}

export function mergeRecordsByUuidMap(
  allResults: AnalysisResult[],
  schema: JsonSchema
): AnalysisResult[] {
  const uuidMap = getUuidRecordMap(allResults);
  const mergedOutput: AnalysisResult[] = [];
  for (const [uuid, group] of uuidMap.entries()) {
    if (group.length === 1) {
      mergedOutput.push(group[0]);
      continue;
    }
    const mergedGroup = mergeGroup(uuid, group);
    mergedOutput.push({
      ...mergedGroup,
      "@context": schema["@context"] || {},
    });
  }
  return mergedOutput;
}
