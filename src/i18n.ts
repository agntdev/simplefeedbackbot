import type { Ctx } from "./bot.js";
import { getUserLanguage, type Language } from "./feedback/store.js";

const en = {
  chooseLanguage: "Choose your language.",
  welcome: "Welcome. Choose an option below.",
  submit: "Submit feedback", mine: "My feedback", settings: "Settings", changeLanguage: "Change language",
  help: "Help", backMenu: "Back to menu", backFeedback: "Back to feedback",
  helpText: "Use Submit feedback to send text, photos, voice messages, or files.\n\nUse My feedback to view, edit, or delete your own submissions. Deleted feedback is kept for 30 days, then removed. Only you can access your feedback.",
  prompt: "Choose a format, or send text, a photo, video, voice message, or file.",
  photo: "Photo", video: "Video", text: "Text", cancel: "Cancel", cancelled: "Submission cancelled.",
  sendPhoto: "Send the photo you want to submit.", sendVideo: "Send the video you want to submit.", sendText: "Type the feedback you want to submit.",
  noFeedback: "No feedback yet — tap Submit feedback to add one.", unavailable: "That feedback item isn't available.",
  edit: "Edit", delete: "Delete", keep: "Keep", editCancel: "Cancel edit", editCancelled: "Edit cancelled.",
  replacement: "Send the replacement text, photo, voice message, or file for feedback #{id}.", updated: "Feedback #{id} has been updated.",
  deleteConfirm: "Delete feedback #{id}? It will be kept for 30 days before removal.", deleted: "Feedback #{id} was deleted. It will be removed after 30 days.",
  attachmentOnly: "Attachment-only feedback", attachments: "Attachments", updatedLabel: "Updated.", yourFeedback: "Your feedback ({page}/{pages})",
  receipt: "Thanks — your feedback has been received (ID: {id}).",
  settingsText: "Choose what you'd like to change.", languageSaved: "Language updated.",
  adminDenied: "Admin access isn't available for your account.",
} as const;

export type TranslationKey = keyof typeof en;
const ru: Record<TranslationKey, string> = {
  chooseLanguage: "Выберите язык.", welcome: "Добро пожаловать. Выберите действие.",
  submit: "Отправить отзыв", mine: "Мои отзывы", settings: "Настройки", changeLanguage: "Сменить язык",
  help: "Помощь", backMenu: "В меню", backFeedback: "К отзывам",
  helpText: "Используйте «Отправить отзыв», чтобы прислать текст, фото, голосовое сообщение или файл.\n\nВ разделе «Мои отзывы» можно посмотреть, изменить или удалить свои отзывы. Удалённые отзывы хранятся 30 дней, затем удаляются. Ваши отзывы доступны только вам.",
  prompt: "Выберите формат или отправьте текст, фото, видео, голосовое сообщение или файл.",
  photo: "Фото", video: "Видео", text: "Текст", cancel: "Отмена", cancelled: "Отправка отменена.",
  sendPhoto: "Отправьте фото для отзыва.", sendVideo: "Отправьте видео для отзыва.", sendText: "Введите текст отзыва.",
  noFeedback: "Отзывов пока нет — нажмите «Отправить отзыв», чтобы добавить первый.", unavailable: "Этот отзыв недоступен.",
  edit: "Изменить", delete: "Удалить", keep: "Оставить", editCancel: "Отменить", editCancelled: "Изменение отменено.",
  replacement: "Отправьте новый текст, фото, голосовое сообщение или файл для отзыва #{id}.", updated: "Отзыв #{id} обновлён.",
  deleteConfirm: "Удалить отзыв #{id}? Он будет храниться ещё 30 дней.", deleted: "Отзыв #{id} удалён. Он будет окончательно удалён через 30 дней.",
  attachmentOnly: "Отзыв только с вложением", attachments: "Вложения", updatedLabel: "Обновлено.", yourFeedback: "Ваши отзывы ({page}/{pages})",
  receipt: "Спасибо — ваш отзыв получен (ID: {id}).",
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
