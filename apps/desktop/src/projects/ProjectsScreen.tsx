import type { Project, Storage } from "@ink-writer/core";
import { InvalidInputError } from "@ink-writer/core";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useLanguage } from "../i18n";
import { describeError } from "../messages";

export interface ProjectsScreenProps {
  readonly storage: Storage;
  readonly onOpen: (project: Project) => void;
}

/** Lists the novels, and asks for title, language and period to start a new one (SPEC §3.8). */
export function ProjectsScreen({ storage, onOpen }: ProjectsScreenProps) {
  const { locale, messages } = useLanguage();
  const [projects, setProjects] = useState<readonly Project[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<string>(locale);
  const [era, setEra] = useState("");
  const titleId = useId();
  const languageId = useId();
  const eraId = useId();

  useEffect(() => {
    let active = true;
    storage.listProjects().then(
      (list) => {
        if (active) setProjects(list);
      },
      (error: unknown) => {
        if (active) setProblem(describeError(error));
      },
    );
    return () => {
      active = false;
    };
  }, [storage]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      const project = await storage.createProject({ title, language, era });
      // Straight to a blank page: writing doesn't require planning anything first (SPEC §3.5).
      const chapter = await storage.createChapter(project.id, messages.firstChapter);
      await storage.createScene(chapter.id, messages.firstScene);
      onOpen(project);
    } catch (error) {
      setProblem(
        error instanceof InvalidInputError ? messages.fieldRequired : describeError(error),
      );
    }
  };

  return (
    <main className="projects">
      <h1>Ink Writer</h1>

      <section aria-labelledby="novels-heading">
        <h2 id="novels-heading">{messages.novels}</h2>
        {projects !== null && projects.length === 0 && <p>{messages.noNovels}</p>}
        <ul className="project-list">
          {projects?.map((project) => (
            <li key={project.id}>
              <button type="button" className="project-open" onClick={() => onOpen(project)}>
                <span className="project-title">{project.title}</span>
                <span className="project-era">{project.era}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="new-novel-heading">
        <h2 id="new-novel-heading">{messages.newNovel}</h2>
        <form className="form" onSubmit={create}>
          <label htmlFor={titleId}>{messages.title}</label>
          <input
            id={titleId}
            value={title}
            required
            onChange={(event) => setTitle(event.target.value)}
          />

          <label htmlFor={languageId}>{messages.language}</label>
          <select
            id={languageId}
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            {Object.entries(messages.languageNames).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>

          <label htmlFor={eraId}>{messages.era}</label>
          <input
            id={eraId}
            value={era}
            required
            placeholder={messages.eraHint}
            onChange={(event) => setEra(event.target.value)}
          />

          <button type="submit" className="primary">
            {messages.create}
          </button>
        </form>
        {problem !== null && (
          <p role="alert" className="problem">
            {problem}
          </p>
        )}
      </section>
    </main>
  );
}
