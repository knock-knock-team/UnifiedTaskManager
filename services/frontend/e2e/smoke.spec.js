import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

test('главная страница: герой виден', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('форма входа', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Пароль')).toBeVisible();
});

test('страница регистрации', async ({ page }) => {
  await page.goto('/register');
  await expect(page.getByLabel('Имя')).toBeVisible();
});
