/*
 * @Author       : Kevin Jobs
 * @Date         : 2022-01-10 12:45:39
 * @LastEditTime : 2022-01-21 16:29:37
 * @lastEditors  : Kevin Jobs
 * @FilePath     : \Horen\packages\horen\main\index.ts
 * @Description  : Electron 主入口文件
 */
import { App } from './app';

new App({
  loadURL: 'http://localhost:8080'
});