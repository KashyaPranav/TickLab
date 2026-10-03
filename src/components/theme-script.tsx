/**
 * Applies the stored theme before first paint so there is no flash of the
 * wrong colour scheme. Must be a blocking inline script in <head>.
 */
const script = `(function(){try{var t=localStorage.getItem("ticklab.theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}