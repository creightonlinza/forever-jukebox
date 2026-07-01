import { useAppStore } from "../store";
import { Trans } from "react-i18next";

export function Footer() {
  const credit = useAppStore((s) => s.footerCredit);
  return (
    <footer className="site-footer">
      <p id="site-footer-credit">
        {credit?.hostedByName ? (
          <Trans
            i18nKey="footer.hosted"
            values={{ host: credit.hostedByName }}
            components={{
              author: <a href="https://creighton.dev" target="_blank" rel="noreferrer" />,
              host: credit.hostedByUrl ? (
                <a href={credit.hostedByUrl} target="_blank" rel="noreferrer" />
              ) : (
                <span />
              ),
            }}
          />
        ) : (
          <Trans
            i18nKey="footer.credit"
            components={{
              author: <a href="https://creighton.dev" target="_blank" rel="noreferrer" />,
            }}
          />
        )}
      </p>
    </footer>
  );
}
