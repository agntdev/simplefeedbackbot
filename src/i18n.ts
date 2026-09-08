import type { Ctx } from "./bot.js";
import { getUserLanguage, type Language } from "./feedback/store.js";

const en = {
  chooseLanguage: "Choose your language.",
  welcome: "Welcome. Choose an option below.",
  submit: "Ask a question", mine: "My questions", settings: "Settings", changeLanguage: "Change language",
  help: "Help", backMenu: "Back to menu", backFeedback: "Back to feedback",
  helpText: "Use Ask a question to send text, photos, voice messages, or files.\n\nUse My questions to view, edit, or delete your own submissions. Deleted questions are kept for 30 days, then removed. Only you can access your questions.",
  prompt: "Send your question as text, a photo, video, voice message, or file.",
  photo: "Photo", video: "Video", text: "Text", cancel: "Cancel", cancelled: "Submission cancelled.",
  sendPhoto: "Send the photo you want to attach to your question.", sendVideo: "Send the video you want to attach to your question.", sendText: "Type your question.",
  noFeedback: "No questions yet — tap Ask a question to send one.", unavailable: "That question isn't available.",
  edit: "Edit", delete: "Delete", keep: "Keep", editCancel: "Cancel edit", editCancelled: "Edit cancelled.",
  replacement: "Send the replacement text, photo, voice message, or file for question #{id}.", updated: "Question #{id} has been updated.",
  deleteConfirm: "Delete question #{id}? It will be kept for 30 days before removal.", deleted: "Question #{id} was deleted. It will be removed after 30 days.",
  attachmentOnly: "Attachment-only question", attachments: "Attachments", updatedLabel: "Updated.", yourFeedback: "Your questions ({page}/{pages})",
  receipt: "Your question has been received (ID: {id}).",
  settingsText: "Choose what you'd like to change.", languageSaved: "Language updated.",
  adminDenied: "Admin access isn't available for your account.",
} as const;

export type TranslationKey = keyof typeof en;
const ru: Record<TranslationKey, string> = {
  chooseLanguage: "Выберите язык.", welcome: "Добро пожаловать. Выберите действие.",
  submit: "Задать вопрос", mine: "Мои вопросы", settings: "Настройки", changeLanguage: "Сменить язык",
  help: "Помощь", backMenu: "В меню", backFeedback: "К отзывам",
  helpText: "Используйте «Задать вопрос», чтобы прислать текст, фото, голосовое сообщение или файл.\n\nВ разделе «Мои вопросы» можно посмотреть, изменить или удалить свои вопросы. Удалённые вопросы хранятся 30 дней, затем удаляются. Ваши вопросы доступны только вам.",
  prompt: "Отправьте вопрос текстом, фото, видео, голосовым сообщением или файлом.",
  photo: "Фото", video: "Видео", text: "Текст", cancel: "Отмена", cancelled: "Отправка отменена.",
  sendPhoto: "Отправьте фото к вопросу.", sendVideo: "Отправьте видео к вопросу.", sendText: "Введите вопрос.",
  noFeedback: "Вопросов пока нет — нажмите «Задать вопрос», чтобы отправить вопрос.", unavailable: "Этот вопрос недоступен.",
  edit: "Изменить", delete: "Удалить", keep: "Оставить", editCancel: "Отменить", editCancelled: "Изменение отменено.",
  replacement: "Отправьте новый текст, фото, голосовое сообщение или файл для вопроса #{id}.", updated: "Вопрос #{id} обновлён.",
  deleteConfirm: "Удалить вопрос #{id}? Он будет храниться ещё 30 дней.", deleted: "Вопрос #{id} удалён. Он будет окончательно удалён через 30 дней.",
  attachmentOnly: "Вопрос только с вложением", attachments: "Вложения", updatedLabel: "Обновлено.", yourFeedback: "Ваши вопросы ({page}/{pages})",
  receipt: "Ваш вопрос принят (ID: {id}).",
  settingsText: "Выберите, что хотите изменить.", languageSaved: "Язык обновлён.",
  adminDenied: "Для вашей учётной записи нет доступа администратора.",
};

export async function language(ctx: Ctx): Promise<Language> { return (await getUserLanguage(ctx)) ?? "en"; }
export async function tr(ctx: Ctx, key: TranslationKey, values: Record<string, string | number> = {}): Promise<string> {
  const table = (await language(ctx)) === "ru" ? ru : en;
  return table[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}
export function trFor(lang: Language, key: TranslationKey, values: Record<string, string | number> = {}): string {
  return (lang === "ru" ? ru : en)[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}
