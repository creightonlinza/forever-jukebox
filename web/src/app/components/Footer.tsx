import { useAppStore } from "../store";

export function Footer() {
  const credit = useAppStore((s) => s.footerCredit);
  return (
    <footer className="site-footer">
      <p id="site-footer-credit">
        The Forever Jukebox &amp; Analysis Engine by{" "}
        <a href="https://creighton.dev" target="_blank" rel="noreferrer">
          Creighton
        </a>
        {credit?.hostedByName ? (
          <>
            . This instance is hosted by{" "}
            {credit.hostedByUrl ? (
              <a href={credit.hostedByUrl} target="_blank" rel="noreferrer">
                {credit.hostedByName}
              </a>
            ) : (
              credit.hostedByName
            )}
            .
          </>
        ) : null}
      </p>
    </footer>
  );
}
