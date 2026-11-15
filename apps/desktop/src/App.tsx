import { openSqlStorage, type Project, type Storage } from "@ink-writer/core";
import { useEffect, useMemo, useState } from "react";
import { LanguageContext } from "./i18n";
import { describeStartupError, MESSAGES, pickLocale } from "./messages";
import { ProjectScreen } from "./project/ProjectScreen";
import { ProjectsScreen } from "./projects/ProjectsScreen";
import type { Shell } from "./shell";

type Boot =
  | { readonly status: "opening" }
  | { readonly status: "ready"; readonly storage: Storage }
  | { readonly status: "failed"; readonly error: unknown };

export interface AppProps {
  readonly shell: Shell;
  readonly language?: string;
}

export function App({ shell, language = navigator.language }: AppProps) {
  const locale = pickLocale(language);
  const value = useMemo(() => ({ locale, messages: MESSAGES[locale] }), [locale]);
  const messages = value.messages;
  const [boot, setBoot] = useState<Boot>({ status: "opening" });
  const [project, setProject] = useState<Project | null>(null);
  /** A novel just created has nothing to show at its Dashboard yet: it opens at its blank page. */
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let active = true;
    openSqlStorage(shell.driver).then(
      ({ storage }) => {
        if (active) setBoot({ status: "ready", storage });
      },
      (error: unknown) => {
        if (active) setBoot({ status: "failed", error });
      },
    );
    return () => {
      active = false;
    };
  }, [shell]);

  return (
    <LanguageContext.Provider value={value}>
      {boot.status === "opening" && (
        <main className="centered">
          <p role="status">{messages.loading}</p>
        </main>
      )}
      {boot.status === "failed" && (
        <main className="centered">
          <h1>Ink Writer</h1>
          <p role="alert" className="problem">
            {describeStartupError(boot.error, messages)}
          </p>
        </main>
      )}
      {boot.status === "ready" &&
        (project === null ? (
          <ProjectsScreen
            storage={boot.storage}
            onOpen={(opened, created) => {
              setFresh(created === true);
              setProject(opened);
            }}
          />
        ) : (
          <ProjectScreen
            key={project.id}
            storage={boot.storage}
            project={project}
            shell={shell}
            startAt={fresh ? "text" : "dashboard"}
            onBack={() => setProject(null)}
          />
        ))}
    </LanguageContext.Provider>
  );
}
