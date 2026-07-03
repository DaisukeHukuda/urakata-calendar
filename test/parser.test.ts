import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSankabi, parseReservations, toCalendarEvent, csvToEvents } from '../src/parser.js';
import { DEFAULT_SYNC_CONFIG } from '../src/types.js';

describe('parseSankabi', () => {
  it('日付＋時刻をJSTの絶対時刻として解釈する', () => {
    const r = parseSankabi('2025/11/12（水） 15:00');
    expect(r).not.toBeNull();
    expect(r!.start.toISOString()).toBe('2025-11-12T06:00:00.000Z');
  });
  it('時刻がない/壊れた文字列は null', () => {
    expect(parseSankabi('')).toBeNull();
    expect(parseSankabi('未定')).toBeNull();
  });
  it('1桁の月日でも解釈できる', () => {
    const r = parseSankabi('2026/6/8（月） 9:30');
    expect(r!.start.toISOString()).toBe('2026-06-08T00:30:00.000Z');
  });
});

describe('parseReservations', () => {
  const csv = readFileSync(new URL('./fixtures/sample.csv', import.meta.url), 'utf-8');
  it('BOM付きCSVを解析し、予約IDのある行を返す', () => {
    const rs = parseReservations(csv);
    expect(rs.length).toBe(3);
    const r = rs.find(x => x.reservationId === '3914186')!;
    expect(r.courseName).toBe('L メガSUP ナイト');
    expect(r.customerName).toBe('福田大介');
    expect(r.pax).toBe(2);
    expect(r.status).toBe('予約確定');
    expect(r.start.toISOString()).toBe('2026-07-10T07:00:00.000Z');
  });
  it('参加日が解釈できない/予約IDが空の行は除外する', () => {
    const broken = '﻿予約ID,コース名,参加日,ステータス,合計,予約者名\n,X,2026/07/10（金） 16:00,予約確定,2,A\n9,Y,未定,予約確定,2,B\n';
    expect(parseReservations(broken).length).toBe(0);
  });
  it('メールアドレス列を email として読む', () => {
    const csv = [
      '予約グループID,予約ID,予約者名,予約者名カナ,電話番号,メールアドレス,コース名,申込日時,参加日,ステータス,合計',
      '1,100,山田太郎,ヤマダタロウ,09011112222,taro@example.com,SUP体験,2026/06/01 10:00,2026/07/10（金） 10:00,予約確定,2',
      '1,101,山田次郎,ヤマダジロウ,09033334444,,SUP体験,2026/06/01 10:00,2026/07/10（金） 10:00,予約確定,2',
    ].join('\n');
    const rs = parseReservations(csv);
    expect(rs[0].email).toBe('taro@example.com');
    expect(rs[1].email).toBeUndefined();
  });
});

describe('toCalendarEvent', () => {
  const base = {
    reservationId: '3914186', courseName: 'L メガSUP ナイト',
    start: new Date('2026-07-10T16:00:00+09:00'), pax: 2,
    customerName: '福田大介', status: '予約確定',
    phone: '09000000000', breakdown: 'x', memo: 'm', media: 'Web予約',
  };
  it('確定予約をイベント化する', () => {
    const e = toCalendarEvent(base, DEFAULT_SYNC_CONFIG);
    expect(e.id).toBe('urkt3914186');
    expect(e.summary).toBe('L メガSUP ナイト・福田大介（2名）');
    expect(e.colorId).toBe(DEFAULT_SYNC_CONFIG.confirmedColorId);
    expect(e.end.getTime() - e.start.getTime()).toBe(120 * 60000);
    expect(e.description).toContain('予約ID: 3914186');
    expect(e.description).toContain('ステータス: 予約確定');
  });
  it('仮予約は【仮】プレフィックスと仮の色', () => {
    const e = toCalendarEvent({ ...base, status: '仮予約' }, DEFAULT_SYNC_CONFIG);
    expect(e.summary.startsWith('【仮】')).toBe(true);
    expect(e.colorId).toBe(DEFAULT_SYNC_CONFIG.provisionalColorId);
  });
  it('リクエスト予約は【リクエスト】プレフィックスと仮の色（承認待ちを区別表示）', () => {
    const e = toCalendarEvent({ ...base, status: 'リクエスト' }, DEFAULT_SYNC_CONFIG);
    expect(e.summary.startsWith('【リクエスト】')).toBe(true);
    expect(e.colorId).toBe(DEFAULT_SYNC_CONFIG.provisionalColorId);
  });
  it('courseDurations があればコース別所要分を使う', () => {
    const cfg = { ...DEFAULT_SYNC_CONFIG, courseDurations: { 'L メガSUP ナイト': 90 } };
    const e = toCalendarEvent(base, cfg);
    expect(e.end.getTime() - e.start.getTime()).toBe(90 * 60000);
  });
});

describe('csvToEvents', () => {
  const csv = readFileSync(new URL('./fixtures/sample.csv', import.meta.url), 'utf-8');
  it('予約確定と仮予約のみイベント化し、キャンセルは除外する', () => {
    const events = csvToEvents(csv, DEFAULT_SYNC_CONFIG);
    const ids = events.map(e => e.id).sort();
    expect(ids).toEqual(['urkt3914186', 'urkt3914187']);
  });
  it('リクエスト予約もイベント化する（承認待ちもカレンダーに表示）', () => {
    const csvWithRequest = [
      '予約グループID,予約ID,予約者名,予約者名カナ,電話番号,メールアドレス,コース名,申込日時,参加日,ステータス,合計',
      '1,200,鈴木一郎,スズキイチロウ,09044445555,d@example.com,SUP体験,2026/06/01 10:00,2026/07/12（日） 10:00,リクエスト,2',
    ].join('\n');
    const events = csvToEvents(csvWithRequest, DEFAULT_SYNC_CONFIG);
    expect(events.map(e => e.id)).toEqual(['urkt200']);
    expect(events[0].summary.startsWith('【リクエスト】')).toBe(true);
  });
});
