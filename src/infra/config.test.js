/* global expect test */
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as uuid from 'uuid';
import {loadConfig} from "./config.js";

test('loadConfig', () => {
  // setup
  const id = uuid.v4();
  const tempConfigFilePath = path.join(os.tmpdir(), id + 'tempConfig.json');
  const tempNumberFile = path.join(os.tmpdir(), id + 'number');
  const tempStringFile = path.join(os.tmpdir(), id + 'string');
  const tempBoolFile = path.join(os.tmpdir(), id + 'false');
  const tempMapFile = path.join(os.tmpdir(), id + 'map');
  fs.writeFileSync(tempNumberFile, '5');
  fs.writeFileSync(tempStringFile, 'e');
  fs.writeFileSync(tempBoolFile, 'false');
  fs.writeFileSync(tempMapFile, 'file');
  // given
  fs.writeFileSync(tempConfigFilePath, JSON.stringify({
    number: 1,
    numberEnv: 2,
    numberArgs: 3,
    numberFile: 4,
    string: 'a',
    stringEnv: 'b',
    stringArgs: 'c',
    stringFile: 'd',
    bool: true,
    boolEnv: true,
    boolArgs: true,
    boolFile: true,
    object: {
      string: 'a',
      stringEnv: 'b',
      stringArgs: 'c'
    },
    map: {
      config: 'config'
    },
    removeString: 'TEST',
    removeNumber: 1,
    removeBool: true,
    removeObject: {
      a: 1
    },
  }));
  const args = [
    '--number-env', '1',
    '--number-args', '4',
    '--string-args', 'd',
    '--bool-args', 'false',
    '--object-string-args', 'd',
    '--map-args', 'args'
  ];
  process.env.TEST_NUMBER_ENV = '3';
  process.env.TEST_NUMBER_FILE_FILE = tempNumberFile;
  process.env.TEST_STRING_ENV = 'c';
  process.env.TEST_STRING_FILE_FILE = tempStringFile;
  process.env.TEST_BOOL_ENV = 'false';
  process.env.TEST_BOOL_FILE_FILE = tempBoolFile;
  process.env.TEST_OBJECT_STRING_ENV = 'c';
  process.env.TEST_MAP_ENV = 'env';
  process.env.TEST_MAP_ENV = 'env';
  process.env.TEST_MAP_FILE_FILE = tempMapFile;
  process.env.TEST_REMOVE_STRING = '';
  process.env.TEST_REMOVE_NUMBER = '';
  process.env.TEST_REMOVE_BOOL = '';
  process.env.TEST_REMOVE_OBJECT = '';
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      number: { type: 'number' },
      numberEnv: { type: 'number' },
      numberArgs: { type: 'number' },
      numberFile: { type: 'number' },
      string: { type: 'string' },
      stringEnv: { type: 'string' },
      stringArgs: { type: 'string' },
      stringFile: { type: 'string' },
      bool: { type: 'boolean' },
      boolEnv: { type: 'boolean' },
      boolArgs: { type: 'boolean' },
      boolFile: { type: 'boolean' },
      object: {
        type: 'object',
        additionalProperties: false,
        properties: {
          string: { type: 'string' },
          stringEnv: { type: 'string' },
          stringArgs: { type: 'string' }
        }
      },
      map: {
        type: 'object',
        additionalProperties: true
      },
      removeString: { type: 'string' },
      removeNumber: { type: 'number' },
      removeBool: { type: 'boolean' },
      removeObject: {
        type: 'object',
        additionalProperties: false,
        properties: {
          a: { type: 'number' }
        }
      }
    }
  };
  // when
  const config = loadConfig(tempConfigFilePath, args, 'TEST', schema);
  // then
  expect(config).toStrictEqual({
    number: 1,
    numberEnv: 3,
    numberArgs: 4,
    numberFile: 5,
    string: 'a',
    stringEnv: 'c',
    stringArgs: 'd',
    stringFile: 'e',
    bool: true,
    boolEnv: false,
    boolArgs: false,
    boolFile: false,
    object: {
      string: 'a',
      stringEnv: 'c',
      stringArgs: 'd'
    },
    map: {
      config: 'config',
      env: 'env',
      args: 'args',
      file: 'file'
    },
    removeString: '', // still present because empty string is falsy
  });
  // clean up
  fs.unlinkSync(tempConfigFilePath);
  fs.unlinkSync(tempNumberFile);
  fs.unlinkSync(tempStringFile);
  fs.unlinkSync(tempBoolFile);
  fs.unlinkSync(tempMapFile);
});
