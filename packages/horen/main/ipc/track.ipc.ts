/*
 * @Author       : Kevin Jobs
 * @Date         : 2022-01-28 14:55:06
 * @LastEditTime : 2022-01-29 00:09:05
 * @lastEditors  : Kevin Jobs
 * @FilePath     : \horen\packages\horen\main\ipc\track.ipc.ts
 * @Description  :
 */
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { ipcMain } from 'electron';
import { TRACK_FORMAT, IPC_CODE } from '../../constant';
import debug from 'debug';
import { readDir, arrayBufferToBase64 } from 'horen-util';
import { Track } from '../../types';
import { TrackModel } from '../db/models';
import myapp from '../app';
import mm from 'music-metadata';

const mydebug = debug('horen:ipc:track');
/**
 * 从缓存中获取音频文件列表
 */
ipcMain.handle(IPC_CODE.track.getListCached, async (evt) => {
  mydebug('从缓存数据库中读取');
  try {
    const allTracks = (await TrackModel.findAll()).map((t) => t.get());
    mydebug('从缓存数据库读取成功');
    return allTracks;
  } catch (err) {
    mydebug('从数据库中读取失败');
  }
});

/**
 * 重建缓存并获取音频文件列表
 */
ipcMain.handle(IPC_CODE.track.rebuildCache, async (evt, paths: string[]) => {
  const rawFilePaths: string[] = [];

  for (const p of paths) {
    mydebug('从给定的目录读取所有文件: ' + p);
    rawFilePaths.push(...(await readDir(p)));
  }

  mydebug('过滤出音频文件');
  const audioFilePaths = getAudioFiles(rawFilePaths);

  mydebug('清空数据库并重新生成');
  try {
    await TrackModel.destroy({ truncate: true });
    mydebug('清空数据库成功');
  } catch (err) {
    throw new Error('清空数据库失败');
  }

  mydebug('从音频文件中解析相关信息');
  const allTracks = await getAudioFilesMeta(
    audioFilePaths,
    audioFilePaths.length
  );

  mydebug('等待写入数据库');
  await saveToDB(allTracks);

  myapp.mainWindow?.webContents.send(IPC_CODE.track.msg, 'done');

  return allTracks;
});

ipcMain.handle(IPC_CODE.track.getByUUID, async (evt, uuid: string) => {
  try {
    const result = await TrackModel.findOne({ where: { uuid } });
    if (result) {
      mydebug('获取音频成功: ' + uuid);
      return result.toJSON();
    } else {
      mydebug('获取音频失败: ' + uuid);
    }
  } catch (err) {
    console.error(err);
    mydebug('获取音频失败: ' + uuid);
  }
});

//
//
//
//
//
//
//

/**
 * 从所有文件中分离音频文件
 * @param files 源文件列表
 * @returns 音频文件列表
 */
function getAudioFiles(files: string[]) {
  return files.filter((f) => {
    const src = path.resolve(f);
    const ext = path.extname(src).replace('.', '');
    return TRACK_FORMAT.includes(ext);
  });
}

/**
 * 解析音频文件元数据
 * @param paths 音频文件地址列表
 * @returns 解析后的音频文件数据
 */
async function getAudioFilesMeta(paths: string[], totals: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracks: any[] = [];

  let index = 1;

  for (const p of paths) {
    const msg = `共${totals}个，当前为第${index}个: ${p}`;

    // 向渲染进程主动发送文件读取情况
    myapp.mainWindow?.webContents.send(IPC_CODE.track.msg, msg);

    const meta = await readMusicMeta(p);
    tracks.push(meta);

    index += 1;
  }

  return tracks;
}

/**
 * 保存音频文件信息到缓存数据库
 * @param tracks 最终需要进行保存的音频列表
 */
async function saveToDB(tracks: Track[]) {
  const chunkSize = 200;
  const tracksToSave: any[] = await getTracksNotCached(tracks);
  for (let i = 0; i < tracks.length; i += chunkSize) {
    try {
      await TrackModel.bulkCreate(tracksToSave.slice(i, i + chunkSize));
      mydebug('写入数据库成功', i, '-', i + chunkSize);
    } catch (err) {
      console.error(err);
      mydebug('写入数据库失败', i, '-', i + chunkSize);
    }
  }
}

/**
 * 找到未缓存的音频文件
 * @param tracks 音频列表
 * @returns 过滤后的列表
 */
async function getTracksNotCached(tracks: Track[]) {
  const temp = [];
  for (const track of tracks) {
    const cached = await isCached(track);
    if (!cached) {
      // mydebug('未缓存，加入缓存列表: ' + track.title);
      temp.push(track);
    } else {
      // mydebug('已经缓存: ' + track.title);
    }
  }
  return temp;
}

/**
 * 解析音频文件元数据
 * @param p 音频文件地址
 * @returns 解析后的音频对象
 */
async function readMusicMeta(p: string) {
  const buffer = await fs.readFile(path.resolve(p));
  const stats = await fs.stat(path.resolve(p));
  let meta;

  try {
    meta = await mm.parseBuffer(buffer);
  } catch (err) {
    meta = null;
    console.error(err);
    mydebug('文件名: ' + p);
  }

  const picture = meta ? meta.common?.picture : '';
  const arrybuffer = picture ? picture[0].data : null;

  return {
    createAt: stats.birthtime.valueOf(),
    updateAt: stats.ctime.valueOf(),
    modifiedAt: stats.mtime.valueOf(),
    //uuid
    src: p,
    title: meta?.common.title,
    year: meta?.common.year,
    artist: meta?.common.artist,
    artists: String(meta?.common.artists),
    albumartist: String(meta?.common.albumartist),
    album: meta?.common.album,
    duration: meta?.format.duration,
    origindate: meta?.common.originalyear,
    originyear: meta?.common.originalyear,
    comment: String(meta?.common.comment),
    genre: String(meta?.common.genre),
    picture: arrybuffer ? arrayBufferToBase64(arrybuffer) : '',
    composer: meta?.common.composer,
    md5: getMd5(buffer),
  } as Track;
}

/**
 * 获取字符串的md5值
 * @param s 传入的字符串
 * @returns md5值
 */
function getMd5(buf: Buffer) {
  const hash = crypto.createHash('md5');
  hash.update(buf);
  return hash.digest('hex');
}

/**
 *
 * @param tracks
 * @returns
 */
async function isCached(track: Track) {
  const result = await TrackModel.findOne({
    where: { md5: track.md5 },
  });
  if (result) return true;
  else return false;
}