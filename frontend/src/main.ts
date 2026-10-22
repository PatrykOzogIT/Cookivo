import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => {
  console.error(err);
  showBootError();
});

/** Start się nie udał (np. zerwane połączenie) - zamiast pustej strony komunikat z odświeżeniem */
function showBootError(): void {
  const root = document.querySelector('app-root');
  if (!root) return;
  const en = document.documentElement.lang === 'en';
  const box = document.createElement('div');
  box.className = 'boot';
  box.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent = en
    ? 'Cookivo could not start. Check your connection and refresh.'
    : 'Nie udało się uruchomić Cookivo. Sprawdź połączenie i odśwież stronę.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = en ? 'Refresh' : 'Odśwież';
  button.addEventListener('click', () => location.reload());
  box.append(text, button);
  root.replaceChildren(box);
}
