#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# -----------------------------------------------------------------------------
# Program Name:           ncbuild
# Program Description:    Script that builds the nCoda Electron app for Posix.
#
# Filename:               nc/ncbuild.py
# Purpose:                This builds and packages everything.
#
# Copyright (C) 2017 Jeff Treviño
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
# -----------------------------------------------------------------------------
'''
Main ncoda build script.
'''
from biplist import readPlist, writePlist
from sys import platform
from os import path
import time
from shutil import copyfile, copytree, rmtree
import os
import subprocess
import tarfile
# call a command line utiity to create an app in a reliable place
# package this app as a disk image using dmgbuild
# requires dmgbuild command line install to work

# programs/julius/node_modules/electron/dist/

# define globals -- assumed relative to macOS directory
PATH_TO_NCODA = ''
PATH_TO_JULIUS = 'julius'
PATH_TO_ELECTRON = os.path.join(
    PATH_TO_JULIUS,
    'node_modules',
    'electron',
    'dist',
    'Electron.app')


MAIN_FOLDER_NAME = 'nCoda.app'
PATH_TO_APP = os.path.join(MAIN_FOLDER_NAME, 'Contents', 'Resources', 'app')


def bundle_electron_app_front_end():
    '''
    Copy files into the bundle's Contents/Resources/app directory.
    '''
    print('Bundling Julius.')
    # copy package.json, index.html, and main_production.js into app directory
    copyfile(os.path.join(PATH_TO_JULIUS, 'index.html'), os.path.join(PATH_TO_APP, 'index.html'))
    copyfile(os.path.join(PATH_TO_JULIUS, 'package.json'), os.path.join(PATH_TO_APP, 'package.json'))
    # include these Julius components:
    front_end_dirs = [
        'fonts',
        'js',
        'lib',
        'css', ]
    # copy Julius dirs into app directory
    for fed in front_end_dirs:
        copytree(
            os.path.join(PATH_TO_JULIUS, fed),
            os.path.join(PATH_TO_APP, fed))
    # get codemirror
    copytree(
        os.path.join(PATH_TO_JULIUS, 'node_modules', 'codemirror'),
        os.path.join(PATH_TO_APP, 'node_modules', 'codemirror'))
    # get electron-log
    copytree(
        os.path.join(PATH_TO_JULIUS, 'node_modules', 'electron-log'),
        os.path.join(PATH_TO_APP, 'node_modules', 'electron-log'))



def set_values_for_plist(plist_path):
    print('Customizing PLists.')
    '''
    Given an input path to a valid OSX plist dict,
    customizes the plist's
    CFBundleDisplayName, CFBundleIdentifier and CFBundleName
    '''
    plist_dict = readPlist(plist_path)
    plist_dict['CFBundleDisplayName'] = 'nCoda'
    plist_dict['CFBundleIdentifier'] = 'org.nCoda.nCoda'
    plist_dict['CFBundleName'] = 'nCoda'
    plist_dict['CFBundleIconFile'] = 'nCoda.icns'
    writePlist(plist_dict, plist_path)


def customize_osx_app_bundle():
    '''
    Supplies a custom icon and swaps in custom PList values for app bundle.
    Changes CFBundleDisplayName, CFBundleIdentifier and CFBundleName,
    in both main and helper apps.
    '''
    print('Customizing OS X app bundle.')
    # Where is the helper app?
    PATH_TO_HELPER = os.path.join('nCoda.app', os.path.join(
        'Contents',
        'Frameworks',
        'Electron Helper.app',
        ))
    # Where are the plists?
    main_plist_path = os.path.join('nCoda.app', 'Contents', 'Info.plist')
    helper_plist_path = os.path.join(PATH_TO_HELPER, 'Contents', 'Info.plist')
    # add icon to bundle
    main_icon_path = os.path.join(
        'nCoda.app',
        'Contents',
        'Resources', 'nCoda.icns')
    copyfile('nCoda.icns', main_icon_path)
    # set plist values for both plist files
    set_values_for_plist(main_plist_path)
    set_values_for_plist(helper_plist_path)


def bundle_electron_app_back_end():
    '''
    Copies back-end components into the app bundle.
    '''
    print('Bundling virtual env, Fujian, and Lychee.')
    back_end_dirs = [
        'fujian',
        'lychee',
        'mercurial-hug',
        'programs'
        ]
    # copy components
    for d in back_end_dirs:
        copytree(os.path.join(PATH_TO_NCODA, d), os.path.join(PATH_TO_APP, d))


def make_dmg_from_app(PATH_TO_APP):
    '''
    (ended up just making the hdiutil directly in before_deploy...)
    (but this would make a nicer-looking .dmg)
    '''
    print('Making .dmg')
    subprocess.call(
        ['dmgbuild',
            '-s',
            'makedmgsettings.py',
            '-D',
            'app=' + PATH_TO_APP,
            'nCoda',
            'nCoda.dmg',
         ]
        )


def package_app():
    '''
    Builds OS X Electron.app app bundle or Windows directory from contents of
    Julius and programs dev directories, by adding files to prebuilt Electron
    bin and customizing Plist files, then packages this as a.dmg file (Mac) or
    Installer (Windows).
    '''
    # copy Electron into curent directory and rename Electron.app
    copytree(PATH_TO_ELECTRON, MAIN_FOLDER_NAME)
    # create app directory
    os.mkdir(PATH_TO_APP)
    # copy js and css assets into app
    bundle_electron_app_front_end()
    # move back end directories into app
    bundle_electron_app_back_end()
    customize_osx_app_bundle()
    time.sleep(0.25)

package_app()
