#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# -----------------------------------------------------------------------------
# Program Name:           ncbuild
# Program Description:    Script that builds the nCoda Electron app for Posix.
#
# Filename:               nc/ncbuild.py
# Purpose:                This builds everything.
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
from plistlib import readPlist, writePlist
from sys import platform
import time
from shutil import copyfile, copytree, rmtree
from os import path, getcwd, walk, name, mkdir, remove, sep, environ
import subprocess
# compile all javascript and css assets
# call a command line utiity to create an app in a reliable place
# package this app as a disk image using dmgbuild
# requires dmgbuild command line install to work

# programs/julius/node_modules/electron/dist/

# define globals -- assumed relative to ncoda/packaging
PATH_TO_NCODA = path.split(getcwd())[0]
PATH_TO_JULIUS = path.join(PATH_TO_NCODA, path.join('programs', 'julius'))
PATH_TO_ELECTRON = path.join(PATH_TO_JULIUS, path.join(
    'node_modules',
    'electron',
    'dist',
    'Electron.app')
    )

if name == 'posix':
    if platform == 'darwin':
        _PATH_TO_NODE = path.join(PATH_TO_NCODA, 'nodejs-6.3.0', 'bin', 'node')
        _PATH_TO_LESSC = path.join(PATH_TO_JULIUS, 'node_modules', '.bin', 'lessc')
        _PATH_TO_WATCHIFY = path.join(PATH_TO_JULIUS, 'node_modules', '.bin', 'watchify')
        _PATH_TO_WATCHMAN = path.join(sep, 'usr', 'local', 'bin', 'watchman-make')
        MAIN_FOLDER_NAME = 'nCoda.app'
        PATH_TO_APP = path.join(MAIN_FOLDER_NAME, 'Contents', 'Resources', 'app')
        PATH_TO_ELECTRON = path.join(PATH_TO_JULIUS, path.join(
            'node_modules',
            'electron',
            'dist',
            'Electron.app')
        )
    if platform == 'linux2':
        raise RunTimeError('Linux is not supported yet.')
elif platform == 'win32':
    # _PATH_TO_WATCHIFY = ?
    # _PATH_TO_WATCHMAN = ?
    MAIN_FOLDER_NAME = 'nCoda'
    PATH_TO_APP = path.join('nCoda', 'resources', 'app')
    PATH_TO_ELECTRON = path.join(getcwd(), 'electron')

else:
    raise RunTimeError("This OS isn't supported.")

# globals for js compilation
# list of the JS files that must be compiled with Watchify; it's input filename, then output filename
_COMPILE_WITH_WATCHIFY = [
    (path.join(PATH_TO_JULIUS, 'js', 'ncoda-init.js'),
        path.join(PATH_TO_APP, 'js', 'ncoda-compiled.js'),)
    ]


# list of the CSS files that must be compiled from LESS; it's the shell path we should ask Watchman
# to watch, then the input and output filenames for lessc.
_COMPILE_WITH_LESSC = [
    (path.join(PATH_TO_JULIUS, 'css', 'ncoda/*.less'),
        path.join(PATH_TO_APP, 'css', 'ncoda', 'main.less'),
        path.join(PATH_TO_APP, 'css', 'ncoda', 'main.css'),)
    ]

def initialize_repositories():
    if name == 'posix':
        if platform == 'linux2':
            raise RunTimeError('Linux not supported yet.')
        elif platform == 'darwin':
            # 

    # elif platform == 'win32':
    #     raise RunTimeError("Windows not supported yet.")
    # else:
    #     raise RunTimeError("OS unsupported.")

def wait_for_existence(files):
    '''
    Given a list with filenames, don't return until all those files exist.
    '''
    print('Waiting for the JavaScript assets to compile.'
         )
    compiled = [False for _ in range(len(files))]
    while not all(compiled):
        time.sleep(0.25)
        for i, pathname in enumerate(files):
            if not compiled[i]:
                if path.exists(pathname):
                    compiled[i] = True


def compile_js_and_css_assets():
    '''
    adapted from julius-electron.py, Copyright Christopher Antila, 2016
    '''
    # remove existing Watchify-compiled files (when they exist again, we'll know they're current)
    for each_file in _COMPILE_WITH_WATCHIFY:
        if path.exists(each_file[1]):
            remove(each_file[1])

    # hold the Popen instances
    subprocesses = []

    try:
        # set up some Watchify instances
        for each_file in _COMPILE_WITH_WATCHIFY:
            print('Starting Watchify for {}'.format(each_file[0]))
            try:
                kummand = [_PATH_TO_NODE, _PATH_TO_WATCHIFY, each_file[0], '-o', each_file[1], '--debug', '--ignore-missing']
                subprocesses.append(subprocess.Popen(kummand))
            except subprocess.CalledProcessError as cperr:
                print('Encountered the following error while starting Watchify:\n{}'.format(cperr))
                raise SystemExit(1)

        # Compile LESS files to CSS
        # first compile the files initially
        for each_file in _COMPILE_WITH_LESSC:
            try:
                kummand = [_PATH_TO_NODE, _PATH_TO_LESSC, '--clean-css', '--source-map', each_file[1], each_file[2]]
                subprocess.check_output(kummand)
            except subprocess.CalledProcessError as cperr:
                print('Encountered the following error while starting lessc:\n{}'.format(cperr))
                raise SystemExit(1)

        # start Watchman
        #
        # the command will look something like this (note the single quotes! And how they're
        #     missing in what we submit below!):
        #  watchman-make --make path_to_lessc -p 'path_to_watch' -t '--clean-css compile_this compiled_path'
        #
        print('Starting Watchman for automatic LESS compilation.')
        kummand = [_PATH_TO_WATCHMAN, '--make', '"{0} {1}"'.format(_PATH_TO_NODE, _PATH_TO_LESSC)]
        for each_file in _COMPILE_WITH_LESSC:
            kummand.append('-p')
            kummand.append('{}'.format(each_file[0]))
            kummand.append('-t')
            kummand.append("--clean-css --source-map {0} {1}".format(each_file[1], each_file[2]))
        try:
            subprocesses.append(subprocess.Popen(kummand))
        except subprocess.CalledProcessError as cperr:
            print('Encountered the following error while starting Watchman:\n{}'.format(cperr))
            raise SystemExit(1)

        # wait for the compiled JavaScript files to appear
        wait_for_existence([x[1] for x in _COMPILE_WITH_WATCHIFY])

        # see whether any of the subprocesses have crashed
        for proc in subprocesses:
            proc.poll()
            if proc.returncode is not None:
                print('\nERROR: One of the processes had a problem; devserver quitting!')
                raise SystemExit(1)

    finally:
        for each_instance in subprocesses:
            # NB: in Python 3, this would raise ProcessLookupError
            try:
                each_instance.terminate()
                print('Terminated subprocess with PID {}'.format(each_instance.pid))
                each_instance.wait()
            except OSError as exc:
                # if it says "No such process" then it already quit, so we're fine
                if 'No such process' in exc.args[1]:
                    print('Process {} already exited'.format(each_instance.pid))
                else:
                    print('Could not terminate subprocess with PID {}'.format(each_instance.pid))


def bundle_electron_app_front_end():
    '''
    Copy files into the bundle's Contents/Resources/app directory.
    '''
    print('Bundling Julius.')
    # copy package.json, index.html, and main_production.js into app directory
    copyfile(path.join(PATH_TO_JULIUS, 'index.html'), path.join(PATH_TO_APP, 'index.html'))
    copyfile(path.join(PATH_TO_JULIUS, 'package.json'), path.join(PATH_TO_APP, 'package.json'))
    # include these Julius components:
    front_end_dirs = [
        'fonts',
        'js',
        'lib',
        'css', ]
    # copy Julius dirs into app directory
    for fed in front_end_dirs:
        copytree(path.join(PATH_TO_JULIUS, fed), path.join(PATH_TO_APP, fed))


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
    PATH_TO_HELPER = path.join('nCoda.app', path.join(
        'Contents',
        'Frameworks',
        'Electron Helper.app',
        ))
    main_plist_path = path.join('nCoda.app', 'Contents', 'Info.plist')
    helper_plist_path = path.join(PATH_TO_HELPER, 'Contents', 'Info.plist')
    # add icon to bundle
    main_icon_path = path.join(
        'nCoda.app',
        'Contents',
        'Resources', 'nCoda.icns')
    copyfile('nCoda.icns', main_icon_path)
    set_values_for_plist(main_plist_path)
    set_values_for_plist(helper_plist_path)


def bundle_electron_app_back_end():
    '''
    Copies back-end components into the app bundle.
    '''
    print('Bundling Fujian and Lychee.')
    back_end_dirs = ['programs', 'lychee-venv']
    # copy components
    for d in back_end_dirs:
        copytree(path.join(PATH_TO_NCODA, d), path.join(PATH_TO_APP, d))
    # rethink after setting up venv in Windows.
    pass


def make_dmg_from_app(PATH_TO_APP):
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


def customize_windows_app_dir():
    pass


def make_installer_from_windows_app_dir():
    pass


def build_app():
    '''
    Builds OS X Electron.app app bundle or Windows directory from contents of
    Julius and programs dev directories, by adding files to prebuilt Electron
    bin and customizing Plist files, then packages this as a.dmg file (Mac) or
    Installer (Windows).
    '''
    # clean
    if name == 'posix' and platform == 'darwin':
        if path.exists(MAIN_FOLDER_NAME + '.dmg'):
            rmtree(MAIN_FOLDER_NAME + '.dmg')
    if path.exists(MAIN_FOLDER_NAME):
        rmtree(MAIN_FOLDER_NAME)
    # copy Electron into curent directory and rename Electron.app
    copytree(PATH_TO_ELECTRON, MAIN_FOLDER_NAME)
    # create app directory
    mkdir(PATH_TO_APP)
    # copy node_modules into app dir
    copytree(path.join(PATH_TO_JULIUS, 'node_modules'), path.join(PATH_TO_APP, 'node_modules'))
    # copy js and css assets into app
    bundle_electron_app_front_end()
    # compile js and css assets
    compile_js_and_css_assets()
    # move back end directories into app
    bundle_electron_app_back_end()
    if name == 'posix' and platform == 'darwin':
        customize_osx_app_bundle()
        time.sleep(0.25)
        make_dmg_from_app(path.join(getcwd(), 'nCoda.app'))
    elif platform == 'win32':
        customize_windows_app_dir()
        # make_installer_from_app_dir()


def package_ncoda():
    initialize_repositories()
    # build_app()

# package_ncoda()
initialize_repositories()