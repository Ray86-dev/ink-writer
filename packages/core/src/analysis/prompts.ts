/**
 * The instructions for each step. Any change here must go through the evaluation in `fixtures/`, and
 * be compared with the previous result.
 *
 * They're in English, and ask for values in the novel's language, so that one set serves every novel.
 */

const LANGUAGE_NAMES: Readonly<Record<string, string>> = { es: "Spanish", en: "English" };

const languageName = (language: string) => LANGUAGE_NAMES[language] ?? language;

export function extractionInstructions(language: string): string {
  return `You read one scene of a novel and list what it states, in a structured way. You never add anything the scene doesn't say.

Go through the scene sentence by sentence, and don't skip any sentence that says something about a person, a place, a date or an event. That includes what a character thinks or notices about someone: if someone thinks that Ana has grey eyes, that's a fact about Ana's eyes.

ENTITIES
List every person, every location, and each story-specific thing or event that matters to the plot (type "lore": a letter, a fishing ban, a ceremony). Ordinary objects and furniture aren't entities.
- "name" is the fullest proper name the scene gives. Use a name from KNOWN ENTITIES when it's clearly the same one.
- "aliases" has other names for the same one, such as a first name, or a job used as a name ("la doctora"). Copy them from the scene. Never use pronouns, articles or family words like "su hermano" as aliases.
- Two people who share a first name are DIFFERENT entities unless the text says they're the same. In "Ana, la maestra" and "Ana Ruiz, la jueza" there are two people: "Ana" with the alias "la maestra", and "Ana Ruiz" with the alias "la jueza". Never mix up their aliases.
- A person who appears only by their job ("la doctora") is listed under that job.

FACTS
List every fact a continuity checker could need, including small actions such as arriving late somewhere: each sentence that says something should give at least one fact.
- "entity" is who or what the fact is about. Work it out when the subject is omitted or is a pronoun: in Spanish a verb like "llegó tarde" has a subject you must find in the context.
- "category" is the closest of these:
  physical: body and appearance, such as eye colour or height.
  age: how old someone is at some moment.
  relative_age: who is older or younger than whom, as in "three years older than him" or "her older brother".
  marital_status: single, married, widowed.
  family: who is whose parent, sibling or child.
  job: what someone works as.
  alive_or_dead: someone dying, being dead or being buried.
  date_of_event: the date or day when something happens or starts.
  travel_time: how long getting from one place to another takes. This includes someone leaving one place and being in another by a stated time, as in "she set off after breakfast and reached the border by noon".
  location: where someone or something is.
  action: anything else someone does, however small.
  possession: what someone owns, has sold or has lost.
  thought: what someone believes, wants or feels.
  other: anything else.
- "attribute" names the fact in a few words, "value" says it, naming whoever a pronoun stands for.
- "quote" is the shortest exact text from the scene that proves the fact, copied character by character, with its original accents and capitals. Never paraphrase or join separate pieces. If you can't quote it, leave the fact out.
- "story_time" says when it happens in the story, if the scene tells (such as "when she was twelve", "two years later"). Otherwise null.

RELATIONS
List the relationships the scene states between two entities, with an exact "quote" as above.

Write attributes, values and labels in ${languageName(language)}. Answer only with the JSON object.`;
}

export function identityInstructions(): string {
  return `You work out who is who in a novel. You get one scene, the entities known so far, and some names from the scene. For each name, decide whether it refers to a known entity.

- Answer with the known entity's id only if the text gives real grounds: a shared job, a place, or an action that ties them together. An epithet like "la doctora" can refer to a known person if the story points to it.
- Two people can share a first name and still be different people. If a name fits more than one known entity and nothing tells them apart, answer null.
- Answer null for anyone new, and whenever you aren't sure. A wrong merge is worse than a missing one.

Answer only with the JSON object, with one answer per name.`;
}

/** The rule for each kind of fact the comparison looks at. */
export const COMPARISON_RULES = {
  physical:
    "These facts are about one body. Eye colour, height and the like don't change by themselves: a trait stated in two different ways is a contradiction, unless one of the facts says what changed it, such as a new scar or dyed hair. Something that only looks different for a moment, or a different trait, isn't related.",
  age: "Someone's age changes over time. Being twelve in a memory and forty now is no error, and neither is any other pair of ages from different moments. Report only ages that can't both hold at the same moment.",
  relative_age:
    "These facts say who is older between two people. If one says that A is older than B, and another says that B is older than A, that's a contradiction. Read them carefully: 'her older cousin' means the cousin is the older one.",
  marital_status:
    "Marital status changes over time. Being single and later married is an evolution, never a contradiction. Report a contradiction only if both are stated for the same moment.",
  family:
    "These facts are about family ties, which don't change. The same person given two different parents is a contradiction. Different relatives aren't.",
  job: "Jobs change over time, which is an evolution. Report a contradiction only if both are stated for the same moment.",
  alive_or_dead:
    "Someone who has died or been buried can't act, talk or phone later in the story. If an action happens after the death in reading order, that's a contradiction, unless the facts say it's a memory, a dream or a recording.",
  date_of_event:
    "If the same event, such as a wedding or a trial, is given two different dates or days, that's a contradiction, even if a character says one of them. Different events can have different dates.",
  travel_time:
    "These facts are about how long journeys take. If the same route takes a long time in one fact and is done much faster in another, that's a contradiction, whoever is travelling. For example, a month by sea against setting off on Monday and arriving on Tuesday. Different routes aren't comparable.",
} as const;

export type ComparedCategory = keyof typeof COMPARISON_RULES;

/** For facts that only share a topic, which may have been filed under any category. */
const TOPIC_RULE = `These facts use the same word, but may be about different things: most pairs are unrelated.
It's a contradiction if both can't be true of the story, as with:
- The same event, such as a wedding or a trial, given two different dates or days, even if a character says one of them.
- The same route taking very different times, whoever travels. For example, a month by sea against setting off on Monday and arriving on Tuesday.
- Who is older between two people, stated in opposite ways. "Her older cousin" means the cousin is the older one.
- A body trait stated in two different ways, with nothing in the facts explaining it.
It isn't a contradiction if:
- It can change over time: where someone is, what they own, their job, whether they're married, how old they are.
- A character says something about their own life in dialogue. They may be lying or mistaken, which is part of the story.
- They're about different people's things. One person selling a house says nothing about another person's house.`;

export function comparisonInstructions(
  language: string,
  category: ComparedCategory | "topic",
): string {
  return `You check a novel for continuity errors. You get a few facts, from numbered scenes in reading order. Facts marked NEW were just added.

${category === "topic" ? TOPIC_RULE : COMPARISON_RULES[category]}

Report each pair with at least one NEW fact that is related in one of these two ways:
- "contradiction": both can't be true of the story.
- "evolution": it changed over time and both are true.
Don't report anything else: if they're unrelated, or about different things, leave them out. An empty list is a normal answer. Use the fact ids exactly as given.

Write each "reason" in ${languageName(language)}, in one short sentence. Answer only with the JSON object.`;
}

/** Second reading of a scene, of what the first one left out. */
export function missedSentencesBlock(sentences: readonly string[]): string {
  return `A first reading found no facts in these sentences of the scene. List what each of them states, if anything. If one of them states nothing, leave it out.\n${sentences
    .map((sentence) => `- ${sentence}`)
    .join("\n")}`;
}

export function proofreadInstructions(language: string): string {
  return `You proofread one scene of a novel written in ${languageName(language)}. Report only typos, spelling mistakes and wrong forms of a word, such as a verb form that should be another one with a similar sound.

Never suggest changes of style, wording, rhythm or punctuation choices. Fiction often breaks rules on purpose: when in doubt, report nothing. Dialogue marks are handled elsewhere. An empty list is the normal answer.

- "quote" is the wrong text, copied character by character from the scene, with just enough words around it to place it.
- "fix" is that same text corrected, and nothing else changed.
- "reason" says what's wrong in ${languageName(language)}, in one short sentence.

Answer only with the JSON object.`;
}
