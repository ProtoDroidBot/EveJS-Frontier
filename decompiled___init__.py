# Decompiled with PyLingual (https://pylingual.io)
# Internal filename: 'C:\\BuildAgent\\work\\b48ff4e85ad420b2\\packages\\monolithconfig\\__init__.py'
# Bytecode version: 3.12.0rc2 (3531)
# Source timestamp: 2026-09-09 12:08:17 UTC (1788955697)

global _monolith_config_service_manager
global _group_callbacks
from collections import defaultdict
import logging
import uthread2
from eveprefs import prefs, boot
from caching.memoize import Memoize
try:
    import blue
except ImportError:
    blue = None
import monolithconfig.synonyms
_monolith_config_service_manager = None
_group_callbacks = defaultdict(list)
log = logging.getLogger('monolithconfig')
live_servers = ['tranquility', 'serenity']
test_servers = ['bond', 'duality', 'eternity', 'helix', 'osmosis', 'singularity', 'bacchus', 'chaos', 'entropy', 'fractal', 'multiplicity', 'pulsar', 'thunderdome', 'winston', 'cosmos']
GLOBAL_CONFIG_GROUP = 'global_config_group'
SSO_TOKEN_ARG_NAME = '/ssoToken='
SERVER_ARG_NAME = '/server:'
REFRESH_TOKEN_ARG_NAME = '/refreshToken='
def set_service_manager(service_manager):
    global _monolith_config_service_manager
    if _monolith_config_service_manager is not None:
        return
    else:
        _monolith_config_service_manager = service_manager
        _trigger_all_callbacks()
def _trigger_all_callbacks():
    for group in _group_callbacks.keys():
        _trigger_group_callback(group)
def _trigger_group_callback(group):
    if group not in _group_callbacks:
        return
    else:
        for callback in _group_callbacks[group]:
            _trigger_callback(callback, group)
def _trigger_callback(callback, group):
    try:
        uthread2.StartTasklet(callback)
    except Exception as e:
        log.exception('Failed to execute callback on group update: (%s)', group)
def flush(group=None):
    if group is None:
        return
    else:
        _trigger_group_callback(group)
def defer_global_config_updates():
    uthread2.StartTasklet(trigger_global_config_updates)
def trigger_global_config_updates():
    flush(GLOBAL_CONFIG_GROUP)
def _get_boot_role():
    if boot is None:
        return ''
    else:
        return boot.role
@Memoize
def on_proxy():
    if _get_boot_role() == 'proxy':
        return True
    else:
        return False
@Memoize
def on_client():
    if _get_boot_role() == 'client':
        return True
    else:
        return False
@Memoize
def on_server():
    if _get_boot_role() == 'server':
        return True
    else:
        return False
def _get_service_manager():
    return _monolith_config_service_manager
def _get_macho_net():
    service_manager = _get_service_manager()
    if service_manager is None:
        return
    else:
        return service_manager.GetService('machoNet')
def _get_cache_service():
    if on_client():
        return
    else:
        if on_server():
            service_manager = _get_service_manager()
            if service_manager is None:
                return
            else:
                return service_manager.GetService('cache')
        else:
            if on_proxy():
                macho_net = _get_macho_net()
                if macho_net is None:
                    return
                else:
                    return macho_net.session.ConnectToAnyService('cache')
            else:
                return None
def _global_config_get(key):
    macho_net = _get_macho_net()
    if macho_net is None:
        return
    else:
        try:
            result = macho_net.GetGlobalConfig().get(key, None)
        except Exception as e:
            result = None
        return result
def _cache_get(group, key):
    if group is None:
        return
    else:
        cache_service = _get_cache_service()
        if cache_service is None:
            return
        else:
            try:
                result = cache_service.Setting(group, key, valueIfNotFound=None)
            except Exception as e:
                result = None
            return result
def _prefs_get(key):
    try:
        result = prefs.GetValue(key, None)
    except Exception as e:
        result = None
    return result
def _boot_get(key):
    try:
        result = boot.GetValue(key, None)
    except Exception as e:
        result = None
    return result
def _get_cmd_arg(arg_name):
    cmd_args = blue.pyos.GetArg()
    for entry in cmd_args:
        if entry.startswith(arg_name):
            return entry[len(arg_name):]
    return ''
def get_value(config_key, config_group=None):
    if config_group:
        if config_group == 'prefs':
            result = _prefs_get(config_key)
            if result is not None:
                return str(result)
        if config_group == 'boot':
            result = _boot_get(config_key)
            if result is not None:
                return str(result)
        result = _cache_get(config_group, config_key)
        if result is not None:
            return str(result)
        else:
            if config_group == 'gc':
                result = _global_config_get(config_key)
                if result is not None:
                    return str(result)
            composite_key = config_group + '.' + config_key
            result = get_value(composite_key)
            if result is not None:
                return str(result)
    result = _global_config_get(config_key)
    if result is not None:
        return str(result)
    else:
        result = _prefs_get(config_key)
        if result is not None:
            return str(result)
        else:
            result = _boot_get(config_key)
            if result is not None:
                return str(result)
            else:
                return result
def enabled(config_key, config_group=None, default=False):
    result = get_value(config_key, config_group)
    if result is None:
        return default
    else:
        result = str(result).lower()
        if result in synonyms.ENABLED:
            return True
        else:
            if result in synonyms.DISABLED:
                return False
            else:
                return False
def add_watch_group_callback(callback, config_group):
    _group_callbacks[config_group].append(callback)
    _trigger_callback(callback, config_group)
def add_global_config_callback(callback):
    add_watch_group_callback(callback, GLOBAL_CONFIG_GROUP)
def remove_watch_group_callback(callback, config_group):
    if config_group in _group_callbacks:
        try:
            _group_callbacks[config_group].remove(callback)
        except ValueError:
            return None
def remove_global_config_callback(callback):
    remove_watch_group_callback(callback, GLOBAL_CONFIG_GROUP)
def get_tier():
    tier = ''
    if on_client():
        tier = get_client_tier()
        return tier
    else:
        tier = get_server_tier()
        return tier
def get_client_tier():
    # irreducible cflow, using cdg fallback
    # ***<module>.get_client_tier: Failure: Compilation Error
    tier = 'dev'
    user_token = get_user_token()
    if not user_token:
        return tier
    tier = user_token['tier']
    tenant = get_client_tenant()
    if tenant.lower()[0:1] == 'u':
        log.info('Tier: %s', 'uat')
            return 'uat'
        if not tenant:
            log.warning('No tenant found, using token tier')
            return tier.lower()
            tier = tier.lower()
            if tier in ['production', 'prod']:
                tier = 'live'
            return tier
            except KeyError as e:
                    return tier.lower()
                            pass
def get_client_token_user():
    user_token = get_user_token()
    if not user_token:
        return
    else:
        subject = None
        try:
            subject = user_token['eve_sub']
        except KeyError as e:
            return subject
        subject_parts = subject.split(':')
        if len(subject_parts)!= 3:
            return
        else:
            if subject_parts[0]!= 'USER':
                return
            else:
                if subject_parts[1]!= 'EVE':
                    return
                else:
                    return subject_parts[2]
def get_client_tenant():
    tenant = None
    user_token = monolithconfig.get_user_token()
    if user_token:
        try:
            tenant = user_token['tenant']
        except Exception:
            pass
    if not user_token:
        tenant = blue.os.GetStartupArgValue('tenant')
    if not tenant:
        server_name = get_client_server_name()
        tenant = server_name
    if not tenant:
        tenant = get_value('clusterName', 'prefs')
    return tenant
def get_client_region():
    # ***<module>.get_client_region: Failure: Different control flow
    region = None
    user_token = get_user_token()
    if user_token:
        try:
            region = user_token['region']
        except Exception as e:
            pass
        return region
def get_refresh_token():
    refresh_token = _get_cmd_arg(REFRESH_TOKEN_ARG_NAME)
    if not refresh_token:
        refresh_token = None
        log.warning('Empty refresh token in cmd args')
    return refresh_token
def get_user_jwt():
    return _get_cmd_arg(SSO_TOKEN_ARG_NAME)
def get_user_token():
    user_token = get_user_jwt()
    if not user_token:
        log.warning('Empty user_token token in cmd args')
        return
    else:
        try:
            from eve.common.lib import jwt
            user_token = jwt.decode(user_token, verify=False)
        except Exception:
            user_token = None
        return user_token
def get_client_server_name():
    server_name = _get_cmd_arg(SERVER_ARG_NAME)
    if not server_name:
        log.warning('Empty server name in cmd args')
        return ''
    else:
        return server_name
def get_server_tier():
    cluster_mode = get_value('clusterMode', 'prefs')
    if not cluster_mode:
        return 'dev'
    else:
        cluster_name = get_value('clusterName', 'prefs')
        if cluster_name.lower() in live_servers:
            return 'live'
        else:
            if cluster_name.lower() in test_servers:
                return 'test'
            else:
                if cluster_mode == 'LOCAL':
                    return 'dev'
                else:
                    if cluster_mode == 'TEST':
                        return 'test'
                    else:
                        if cluster_mode == 'UAT':
                            return 'uat'
                        else:
                            if cluster_mode == 'LIVE':
                                return 'live'
                            else:
                                return 'dev'
def get_cluster_name():
    machonet = _get_macho_net()
    if not machonet:
        return
    else:
        return machonet.GetConnectedClusterName()